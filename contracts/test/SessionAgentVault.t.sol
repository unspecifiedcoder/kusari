// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {KusariFixture} from "./utils/KusariFixture.sol";
import {SessionAgentVault} from "../src/SessionAgentVault.sol";
import {SessionVaultFactory} from "../src/SessionVaultFactory.sol";
import {SwapIntent} from "../src/interfaces/PolicyTypes.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {EasyPosm} from "./utils/libraries/EasyPosm.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract CallbackSessionAgent {
    SessionAgentVault public vault;
    PoolKey private _key;
    SwapIntent private _intent;
    bool public callbackSeen;
    bool public reentryBlocked;
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) { return 0x1626ba7e; }
    function execute(SessionAgentVault v, PoolKey memory key, SwapIntent memory intent) external returns (BalanceDelta) {
        vault = v; _key = key; _intent = intent;
        return v.swap(key, intent, "");
    }
    function onTokenTransfer() external {
        callbackSeen = true;
        try vault.swap(_key, _intent, "") {} catch (bytes memory reason) {
            reentryBlocked = reason.length >= 4 && bytes4(reason) == SessionAgentVault.ReentrantCall.selector;
        }
    }
}

contract CallbackSessionToken is MockERC20 {
    address public callbackVault;
    CallbackSessionAgent public callbackAgent;
    constructor() MockERC20("Callback", "CALL", 18) {}
    function setCallback(address v, CallbackSessionAgent a) external { callbackVault = v; callbackAgent = a; }
    function transfer(address to, uint256 amount) public override returns (bool) {
        bool result = super.transfer(to, amount);
        if (msg.sender == callbackVault) callbackAgent.onTokenTransfer();
        return result;
    }
}

contract SessionAgentVaultTest is KusariFixture {
    using EasyPosm for IPositionManager;
    address owner = makeAddr("session.owner");
    SessionVaultFactory factory;
    SessionAgentVault vault;

    function setUp() public {
        _setUpKusari();
        factory = new SessionVaultFactory(poolManager, address(hook), currency0, currency1, poolId);
        vm.prank(owner);
        vault = factory.create(agent);
        currency0.transfer(address(vault), 10e18);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy(1e18, 100e18, 3000));
        _open(3e18, 0.90e18, uint64(block.timestamp + 1 hours));
    }

    function _open(uint256 budget, uint256 rate, uint64 expiry) internal {
        vm.prank(owner);
        vault.openSession(budget, expiry, rate);
    }
    function _trade(uint256 amount, uint256 nonce, uint256 minimum) internal returns (BalanceDelta) {
        SwapIntent memory intent = _intent(agent, address(vault), amount, nonce);
        intent.minAmountOut = minimum;
        bytes memory sig = _sign(agentPk, intent);
        vm.prank(agent);
        return vault.swap(poolKey, intent, sig);
    }

    function test_compromisedAgent_smallTradesExhaustFiniteAllowance() public {
        for (uint256 n; n < 3; n++) assertGt(_trade(1e18, n, 0).amount1(), 0);
        assertEq(vault.remainingBudget(), 0);
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 3e18);
        vm.expectRevert(SessionAgentVault.SessionBudgetExceeded.selector);
        _trade(1e18, 3, 0);
        // The ENS role and daily cap are still permissive; the additional boundary is the session.
        assertTrue(source.isAuthorized(agent));
        assertEq(currency0.balanceOf(address(vault)), 7e18);
    }

    function test_expiryBlocksAtExactDeadline_withoutConsumingAllowance() public {
        vm.warp(vault.sessionExpiresAt());
        vm.expectRevert(SessionAgentVault.SessionExpired.selector);
        _trade(1e18, 0, 0);
        assertEq(vault.remainingBudget(), 3e18);
        assertFalse(hook.nonceUsed(agent, 0));
    }

    function test_zeroAndTinyAgentMinimum_cannotBypassOwnerFloor() public {
        _open(3e18, 1e18, uint64(block.timestamp + 1 hours));
        vm.expectPartialRevert(SessionAgentVault.OwnerOutputFloorNotMet.selector);
        _trade(1e18, 0, 0);
        vm.expectPartialRevert(SessionAgentVault.OwnerOutputFloorNotMet.selector);
        _trade(1e18, 1, 1);
        assertEq(vault.remainingBudget(), 3e18);
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 0);
        assertFalse(hook.nonceUsed(agent, 0));
        assertFalse(hook.nonceUsed(agent, 1));
        assertEq(currency0.balanceOf(address(vault)), 10e18);
        assertEq(currency1.balanceOf(address(vault)), 0);
        // Pool state rolled back as well: lowering the owner floor allows the same nonce and trade.
        _open(3e18, 0.90e18, uint64(block.timestamp + 1 hours));
        assertGt(_trade(1e18, 0, 0).amount1(), 0);
    }

    function test_ownerFloorRoundsUp_notDown() public {
        source.setPolicy(agent, _policy(2e18, 100e18, 3000));
        uint256 snapshot = vm.snapshotState();
        uint256 amount = 1e18 + 1;
        BalanceDelta observed = _trade(amount, 0, 0);
        uint256 output = uint256(uint128(observed.amount1()));
        assertTrue(output < 1e18);
        assertTrue(vm.revertToState(snapshot));
        // actualInput = 1e18+1; rate = output; floor division would allow output,
        // while the required ceiling is output+1. Agent minAmountOut is deliberately zero.
        _open(3e18, output, uint64(block.timestamp + 1 hours));
        vm.expectRevert(abi.encodeWithSelector(SessionAgentVault.OwnerOutputFloorNotMet.selector, output, output + 1));
        _trade(amount, 0, 0);
        assertEq(vault.remainingBudget(), 3e18);
    }

    function test_partialFillChargesFullRequest_andFloorUsesActualInput() public {
        positionManager.burn(positionManager.nextTokenId() - 1, 0, 0, address(this), block.timestamp, "");
        positionManager.mint(poolKey, -60, 60, 100e18, 1e18, 1e18, address(this), block.timestamp, "");
        // A narrow range fills only part of the request, then the price crosses empty liquidity.
        source.setPolicy(agent, _policy(1e18, 100e18, 10000));
        BalanceDelta delta = _trade(1e18, 0, 0);
        uint256 actualInput = uint256(-int256(delta.amount0()));
        uint256 actualOutput = uint256(uint128(delta.amount1()));
        assertGt(actualInput, 0);
        assertLt(actualInput, 1e18);
        assertGe(actualOutput, Math.mulDiv(actualInput, 0.90e18, 1e18, Math.Rounding.Ceil));
        assertEq(vault.remainingBudget(), 2e18); // no partial-fill allowance refund
        assertEq(currency0.balanceOf(address(vault)), 10e18 - actualInput);
    }

    function test_extremeOwnerFloorOverflowFailsClosed_andRollsBack() public {
        source.setPolicy(agent, _policy(2e18, 100e18, 3000));
        _open(3e18, type(uint256).max, uint64(block.timestamp + 1 hours));
        vm.expectRevert(Math.MathOverflowedMulDiv.selector);
        _trade(1e18 + 1, 0, 0);
        assertEq(vault.remainingBudget(), 3e18);
        assertEq(hook.spentOn(agent, block.timestamp / 1 days), 0);
        assertFalse(hook.nonceUsed(agent, 0));
        assertEq(currency0.balanceOf(address(vault)), 10e18);
    }

    function test_sessionsArePerVault_evenForSameAgent() public {
        address secondOwner = makeAddr("session.second.owner");
        vm.prank(secondOwner);
        SessionAgentVault second = factory.create(agent);
        currency0.transfer(address(second), 2e18);
        vm.prank(secondOwner);
        second.openSession(1e18, uint64(block.timestamp + 1 hours), 0.90e18);
        for (uint256 n; n < 3; n++) _trade(1e18, n, 0);
        assertEq(vault.remainingBudget(), 0);
        assertEq(second.remainingBudget(), 1e18);
        vm.prank(owner);
        vault.closeSession();
        assertEq(second.remainingBudget(), 1e18);
        vm.prank(owner);
        vm.expectRevert(SessionAgentVault.OnlyOwner.selector);
        second.openSession(100e18, uint64(block.timestamp + 1 hours), 1);
        SwapIntent memory intent = _intent(agent, address(second), 1e18, 3);
        bytes memory sig = _sign(agentPk, intent);
        vm.prank(agent);
        second.swap(poolKey, intent, sig);
        assertEq(vault.remainingBudget(), 0);
        assertEq(second.remainingBudget(), 0);
    }

    function test_hookRejectionRollsBackSessionReservation() public {
        source.setAuthorized(agent, false);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.NotAuthorized.selector));
        _trade(1e18, 0, 0);
        assertEq(vault.remainingBudget(), 3e18);
        assertFalse(hook.nonceUsed(agent, 0));
        assertEq(currency0.balanceOf(address(vault)), 10e18);
    }

    function test_successEmitsActualAmountsAndRemainingBudget() public {
        vm.recordLogs();
        BalanceDelta delta = _trade(1e18, 0, 0);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter == address(vault) && entries[i].topics[0] == keccak256("SessionSwap(uint256,uint256,uint256,uint256,uint256)")) {
                (uint256 requested, uint256 actualIn, uint256 actualOut, uint256 remaining) = abi.decode(entries[i].data, (uint256, uint256, uint256, uint256));
                assertEq(uint256(entries[i].topics[1]), 1);
                assertEq(requested, 1e18);
                assertEq(actualIn, uint256(-int256(delta.amount0())));
                assertEq(actualOut, uint256(uint128(delta.amount1())));
                assertEq(remaining, 2e18);
                assertEq(currency1.balanceOf(address(vault)), actualOut);
                found = true;
            }
        }
        assertTrue(found);
    }

    function test_agentCannotOpenRenewCloseOrWithdraw() public {
        vm.startPrank(agent);
        vm.expectRevert(SessionAgentVault.OnlyOwner.selector);
        vault.openSession(100e18, uint64(block.timestamp + 1 hours), 1);
        vm.expectRevert(SessionAgentVault.OnlyOwner.selector);
        vault.closeSession();
        vm.expectRevert(SessionAgentVault.OnlyOwner.selector);
        vault.withdraw(currency0, agent, 1e18);
        vm.stopPrank();
        assertEq(vault.remainingBudget(), 3e18);
        assertEq(vault.minRateWad(), 0.90e18);
    }

    function test_ownerCanCloseRenewAndWithdraw() public {
        vm.prank(owner);
        vault.closeSession();
        vm.expectRevert(SessionAgentVault.SessionExpired.selector);
        _trade(1e18, 0, 0);
        _open(1e18, 0.90e18, uint64(block.timestamp + 1 hours));
        assertEq(vault.sessionId(), 2);
        _trade(1e18, 0, 0);
        vm.prank(owner);
        vault.withdraw(currency0, owner, 2e18);
        assertEq(currency0.balanceOf(owner), 2e18);
    }

    function test_invalidSessionsAndIdentityRejected() public {
        vm.startPrank(owner);
        vm.expectRevert(SessionAgentVault.InvalidSession.selector);
        vault.openSession(0, uint64(block.timestamp + 1), 1);
        vm.expectRevert(SessionAgentVault.InvalidSession.selector);
        vault.openSession(1, uint64(block.timestamp + 1), 0);
        vm.expectRevert(SessionAgentVault.InvalidSession.selector);
        vault.openSession(1, uint64(block.timestamp), 1);
        vm.expectRevert(SessionAgentVault.InvalidSession.selector);
        vault.openSession(1, uint64(block.timestamp + 30 days + 1), 1);
        vm.expectRevert(SessionAgentVault.InvalidIdentity.selector);
        factory.create(owner);
        vm.expectRevert(SessionAgentVault.InvalidIdentity.selector);
        factory.create(address(0));
        vm.stopPrank();
    }

    function test_invalidManagerOrHookCannotCreateSessionVaults() public {
        vm.expectRevert(SessionAgentVault.InvalidPool.selector);
        new SessionAgentVault(IPoolManager(address(0)), owner, agent, address(hook), currency0, currency1, poolId);
        vm.expectRevert(SessionAgentVault.InvalidPool.selector);
        new SessionAgentVault(poolManager, owner, agent, makeAddr("session.no.code.hook"), currency0, currency1, poolId);
        vm.expectRevert(SessionAgentVault.InvalidPool.selector);
        new SessionVaultFactory(IPoolManager(address(0)), address(hook), currency0, currency1, poolId);
        vm.expectRevert(SessionAgentVault.InvalidPool.selector);
        new SessionVaultFactory(poolManager, address(0), currency0, currency1, poolId);
    }

    function test_wrongPoolDirectionAndCallerCannotReachSwap() public {
        SwapIntent memory intent = _intent(agent, address(vault), 1e18, 0);
        bytes memory sig = _sign(agentPk, intent);
        vm.expectRevert(SessionAgentVault.OnlyAgent.selector);
        vault.swap(poolKey, intent, sig);
        PoolKey memory other = poolKey;
        other.fee = 500;
        vm.prank(agent);
        vm.expectRevert(SessionAgentVault.InvalidPool.selector);
        vault.swap(other, intent, sig);
        intent.zeroForOne = false;
        sig = _sign(agentPk, intent);
        vm.prank(agent);
        vm.expectRevert(SessionAgentVault.InvalidInput.selector);
        vault.swap(poolKey, intent, sig);
        vm.expectRevert(SessionAgentVault.OnlyPoolManager.selector);
        vault.unlockCallback("");
    }

    function test_erc1271Agent_tokenCallbackCannotReenter() public {
        CallbackSessionAgent contractAgent = new CallbackSessionAgent();
        vm.prank(owner);
        SessionAgentVault own = factory.create(address(contractAgent));
        currency0.transfer(address(own), 3e18);
        source.setAuthorized(address(contractAgent), true);
        source.setPolicy(address(contractAgent), _policy(1e18, 100e18, 3000));
        vm.prank(owner);
        own.openSession(2e18, uint64(block.timestamp + 1 hours), 0.90e18);
        // Preserve ERC20 balances/storage, add a transfer callback to the fixture token's code.
        CallbackSessionToken callbackCode = new CallbackSessionToken();
        vm.etch(Currency.unwrap(currency0), address(callbackCode).code);
        CallbackSessionToken(Currency.unwrap(currency0)).setCallback(address(own), contractAgent);
        SwapIntent memory intent = _intent(address(contractAgent), address(own), 1e18, 0);
        BalanceDelta delta = contractAgent.execute(own, poolKey, intent);
        assertGt(delta.amount1(), 0);
        assertTrue(contractAgent.callbackSeen());
        assertTrue(contractAgent.reentryBlocked());
        assertEq(own.remainingBudget(), 1e18);
    }
}
