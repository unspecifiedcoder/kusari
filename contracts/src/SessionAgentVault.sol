// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SwapIntent} from "./interfaces/PolicyTypes.sol";

/// @notice Owner-bounded trading sessions layered on the existing ENS/Uniswap policy hook.
/// @dev Standalone contract: there is no inherited AgentVault.swap entry point that bypasses sessions.
/// A successful swap charges the FULL requested input against the finite session allowance, even if
/// the pool partially fills it. The owner output rate is checked against ACTUAL input/output deltas.
/// Reverting the output check rolls back the pool, ENS-hook accounting, nonce and session reservation.
contract SessionAgentVault is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    uint256 public constant MAX_SESSION_DURATION = 30 days;
    IPoolManager public immutable poolManager;
    address public immutable owner;
    address public immutable agent;
    address public immutable hook;
    Currency public immutable token0;
    Currency public immutable token1;
    PoolId public immutable allowedPool;

    uint256 public remainingBudget;
    uint64 public sessionExpiresAt;
    uint256 public minRateWad;
    uint256 public sessionId;
    bool private _entered;
    bool private _callbackExpected;

    error OnlyOwner();
    error OnlyAgent();
    error OnlyPoolManager();
    error InvalidIdentity();
    error InvalidPool();
    error InvalidSession();
    error SessionExpired();
    error SessionBudgetExceeded();
    error IntentNotForVault();
    error InvalidInput();
    error InvalidSwapDelta();
    error OwnerOutputFloorNotMet(uint256 actualOutput, uint256 requiredOutput);
    error ReentrantCall();

    event SessionOpened(uint256 indexed sessionId, uint256 totalBudget, uint64 expiresAt, uint256 minRateWad);
    event SessionClosed(uint256 indexed sessionId);
    event SessionSwap(uint256 indexed sessionId, uint256 requestedInput, uint256 actualInput, uint256 actualOutput, uint256 remainingBudget);
    event Withdrawn(address indexed to, Currency indexed currency, uint256 amount);

    constructor(IPoolManager _poolManager, address _owner, address _agent, address _hook,
        Currency _token0, Currency _token1, PoolId _allowedPool)
    {
        if (_owner == address(0) || _agent == address(0) || _owner == _agent) revert InvalidIdentity();
        if (address(_poolManager).code.length == 0 || _hook.code.length == 0 || Currency.unwrap(_token0) >= Currency.unwrap(_token1) || PoolId.unwrap(_allowedPool) == bytes32(0)) revert InvalidPool();
        poolManager = _poolManager;
        owner = _owner;
        agent = _agent;
        hook = _hook;
        token0 = _token0;
        token1 = _token1;
        allowedPool = _allowedPool;
    }

    modifier onlyOwner() { if (msg.sender != owner) revert OnlyOwner(); _; }
    modifier nonReentrant() {
        if (_entered) revert ReentrantCall();
        _entered = true;
        _;
        _entered = false;
    }

    receive() external payable {}

    /// @notice Replace the previous session. Only the owner can grant more budget or change the floor.
    /// Rate is token1 raw output per token0 raw input, scaled by 1e18. Expiry is exclusive.
    function openSession(uint256 totalBudget, uint64 expiresAt, uint256 ownerMinRateWad) external onlyOwner nonReentrant {
        if (totalBudget == 0 || ownerMinRateWad == 0 || expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_SESSION_DURATION) revert InvalidSession();
        remainingBudget = totalBudget;
        sessionExpiresAt = expiresAt;
        minRateWad = ownerMinRateWad;
        sessionId++;
        emit SessionOpened(sessionId, totalBudget, expiresAt, ownerMinRateWad);
    }

    function closeSession() external onlyOwner nonReentrant {
        remainingBudget = 0;
        sessionExpiresAt = 0;
        minRateWad = 0;
        emit SessionClosed(sessionId);
    }

    function swap(PoolKey calldata key, SwapIntent calldata intent, bytes calldata signature)
        external nonReentrant returns (BalanceDelta delta)
    {
        if (msg.sender != agent) revert OnlyAgent();
        if (intent.vault != address(this) || intent.agent != agent) revert IntentNotForVault();
        if (address(key.hooks) != hook || Currency.unwrap(key.currency0) != Currency.unwrap(token0) || Currency.unwrap(key.currency1) != Currency.unwrap(token1) || PoolId.unwrap(key.toId()) != PoolId.unwrap(allowedPool)) revert InvalidPool();
        if (!intent.zeroForOne || intent.amountIn == 0 || intent.amountIn > uint256(uint128(type(int128).max))) revert InvalidInput();
        if (sessionExpiresAt == 0 || block.timestamp >= sessionExpiresAt) revert SessionExpired();
        if (intent.amountIn > remainingBudget) revert SessionBudgetExceeded();
        // Effects before the PoolManager call. A revert anywhere below restores this reservation.
        remainingBudget -= intent.amountIn;
        _callbackExpected = true;
        delta = abi.decode(poolManager.unlock(abi.encode(key, intent, signature)), (BalanceDelta));
        if (_callbackExpected) revert InvalidSwapDelta(); // configured manager must have executed our callback
        if (delta.amount0() >= 0 || delta.amount1() <= 0) revert InvalidSwapDelta();
        uint256 actualInput = uint256(-int256(delta.amount0()));
        uint256 actualOutput = uint256(uint128(delta.amount1()));
        if (actualInput > intent.amountIn) revert InvalidSwapDelta();
        uint256 requiredOutput = Math.mulDiv(actualInput, minRateWad, 1e18, Math.Rounding.Ceil);
        if (actualOutput < requiredOutput) revert OwnerOutputFloorNotMet(actualOutput, requiredOutput);
        emit SessionSwap(sessionId, intent.amountIn, actualInput, actualOutput, remainingBudget);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_entered || !_callbackExpected) revert OnlyPoolManager();
        _callbackExpected = false;
        (PoolKey memory key, SwapIntent memory intent, bytes memory signature) = abi.decode(data, (PoolKey, SwapIntent, bytes));
        BalanceDelta delta = poolManager.swap(key, SwapParams({
            zeroForOne: true, amountSpecified: -int256(intent.amountIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }), abi.encode(intent, signature));
        _settleOrTake(key.currency0, delta.amount0());
        _settleOrTake(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function withdraw(Currency currency, address to, uint256 amount) external onlyOwner nonReentrant {
        currency.transfer(to, amount);
        emit Withdrawn(to, currency, amount);
    }

    function _settleOrTake(Currency currency, int128 amount) private {
        if (amount < 0) {
            uint256 owed = uint256(-int256(amount));
            if (currency.isAddressZero()) poolManager.settle{value: owed}();
            else { poolManager.sync(currency); currency.transfer(address(poolManager), owed); poolManager.settle(); }
        } else if (amount > 0) poolManager.take(currency, address(this), uint256(uint128(amount)));
    }
}
