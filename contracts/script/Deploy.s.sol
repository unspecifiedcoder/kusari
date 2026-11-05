// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {Constants} from "@uniswap/v4-core/test/utils/Constants.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";

import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

import {PolicyHook} from "src/PolicyHook.sol";
import {AgentVault} from "src/AgentVault.sol";
import {AgentVaultFactory} from "src/AgentVaultFactory.sol";
import {IPolicySource} from "src/interfaces/IPolicySource.sol";
import {Policy} from "src/interfaces/PolicyTypes.sol";
import {MockPolicySource} from "src/mocks/MockPolicySource.sol";
import {PolicyMirror} from "src/PolicyMirror.sol";

/// @notice Deploys Kusari on any chain listed in config/chains.json and writes deployments/<chainId>.json.
///
/// Env:
///   POLICY_SOURCE   address of an existing IPolicySource (e.g. ENSPolicySource). Overrides POLICY_KIND.
///   POLICY_KIND     "mirror" = deploy an owner-controlled PolicyMirror (use on public chains)
///                   "mock"   = MockPolicySource, NO access control (local forks only). Default: mock.
///   AGENT_ADDRESS   optional: create a demo vault for this agent, fund it, and authorize it (mock/mirror).
///   OWNER_ADDRESS   optional: owner of the demo vault (can withdraw + freeze). Default: the deployer.
///   DEPLOY_TAG      optional filename suffix, e.g. "-fork" for local runs (gitignored).
///
/// Local:  anvil --fork-url $SEPOLIA_RPC_URL   then
///         forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key <anvil key>
contract Deploy is Script {
    using PoolIdLibrary for PoolKey;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint128 constant LIQUIDITY = 1_000e18;
    uint256 constant VAULT_FUNDING = 100e18;

    struct Out {
        address policySource;
        address hook;
        address factory;
        address token0;
        address token1;
        PoolId poolId;
        address demoVault;
    }

    IPoolManager poolManager;
    IPositionManager posm;
    IPermit2 permit2;
    Out out;
    string kind;

    function run() external returns (Out memory) {
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/../config/chains.json"));
        string memory k = string.concat(".", vm.toString(block.chainid), ".uniswap.");
        poolManager = IPoolManager(vm.parseJsonAddress(cfg, string.concat(k, "poolManager")));
        posm = IPositionManager(vm.parseJsonAddress(cfg, string.concat(k, "positionManager")));
        permit2 = IPermit2(vm.parseJsonAddress(cfg, string.concat(k, "permit2")));
        address agent = vm.envOr("AGENT_ADDRESS", address(0));
        address source = vm.envOr("POLICY_SOURCE", address(0));
        kind = source != address(0) ? "external" : vm.envOr("POLICY_KIND", string("mock"));

        vm.startBroadcast();
        address owner = vm.envOr("OWNER_ADDRESS", msg.sender);
        if (_is("external")) out.policySource = source;
        else if (_is("mirror")) out.policySource = address(new PolicyMirror(msg.sender));
        else if (_is("mock")) out.policySource = address(new MockPolicySource());
        else revert("POLICY_KIND must be mirror or mock");
        if (_is("mock")) {
            require(block.chainid == 31337 || vm.envOr("ALLOW_MOCK", false), "mock policy has no access control: forks only (ALLOW_MOCK=true)");
            console2.log("WARNING: MockPolicySource has no access control. Local forks only.");
        }
        _deployHook();
        PoolKey memory key = _deployPool(msg.sender);
        out.factory = address(new AgentVaultFactory(poolManager, out.hook));
        if (agent != address(0)) _demoVault(agent, owner, key);
        vm.stopBroadcast();

        _write(out);
        return out;
    }

    function _is(string memory k) internal view returns (bool) {
        return keccak256(bytes(kind)) == keccak256(bytes(k));
    }

    /// @dev Hook at a mined CREATE2 address whose low bits encode BEFORE_SWAP | AFTER_SWAP.
    function _deployHook() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG);
        bytes memory args = abi.encode(poolManager, IPolicySource(out.policySource));
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, flags, type(PolicyHook).creationCode, args);
        PolicyHook hook = new PolicyHook{salt: salt}(poolManager, IPolicySource(out.policySource));
        require(address(hook) == predicted, "hook address mismatch");
        out.hook = address(hook);
    }

    /// @dev Demo token pair, pool with the hook, full-range liquidity.
    function _deployPool(address deployer) internal returns (PoolKey memory key) {
        MockERC20 a = new MockERC20("Kusari USD", "kUSD", 18);
        MockERC20 b = new MockERC20("Kusari ETH", "kETH", 18);
        (MockERC20 t0, MockERC20 t1) = address(a) < address(b) ? (a, b) : (b, a);
        t0.mint(deployer, 1_000_000e18);
        t1.mint(deployer, 1_000_000e18);
        out.token0 = address(t0);
        out.token1 = address(t1);

        key = PoolKey(Currency.wrap(address(t0)), Currency.wrap(address(t1)), 3000, 60, IHooks(out.hook));
        out.poolId = key.toId();
        poolManager.initialize(key, Constants.SQRT_PRICE_1_1);
        _approve(t0);
        _approve(t1);
        _addLiquidity(key, deployer);
    }

    function _addLiquidity(PoolKey memory key, address deployer) internal {
        int24 lower = TickMath.minUsableTick(60);
        int24 upper = TickMath.maxUsableTick(60);
        (uint256 a0, uint256 a1) = LiquidityAmounts.getAmountsForLiquidity(
            Constants.SQRT_PRICE_1_1, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), LIQUIDITY
        );
        // MINT_POSITION then SETTLE_PAIR (the broadcaster pays via Permit2)
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(LIQUIDITY), a0 + 1, a1 + 1, deployer, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        posm.modifyLiquidities(abi.encode(actions, params), block.timestamp + 600);
    }

    /// @dev The vault is owned by `owner` (not the deployer) so the owner wallet can withdraw and freeze.
    function _demoVault(address agent, address owner, PoolKey memory) internal {
        AgentVault v = new AgentVault(poolManager, owner, agent, out.hook);
        MockERC20(out.token0).transfer(address(v), VAULT_FUNDING);
        out.demoVault = address(v);
        Policy memory p = Policy({maxPerSwap: 5e18, dailyCap: 20e18, maxImpactBps: 200, allowedPool: out.poolId, active: true});
        if (_is("mirror")) {
            PolicyMirror(out.policySource).setPolicy(agent, owner, p);
        } else if (_is("mock")) {
            MockPolicySource(out.policySource).setAuthorized(agent, true);
            MockPolicySource(out.policySource).setPolicy(agent, p);
        }
    }

    function _approve(MockERC20 t) internal {
        t.approve(address(permit2), type(uint256).max);
        permit2.approve(address(t), address(posm), type(uint160).max, type(uint48).max);
    }

    function _write(Out memory d) internal {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeString(o, "policyKind", kind);
        vm.serializeAddress(o, "policySource", d.policySource);
        vm.serializeAddress(o, "policyHook", d.hook);
        vm.serializeAddress(o, "vaultFactory", d.factory);
        vm.serializeAddress(o, "token0", d.token0);
        vm.serializeAddress(o, "token1", d.token1);
        vm.serializeAddress(o, "demoVault", d.demoVault);
        string memory json = vm.serializeBytes32(o, "poolId", PoolId.unwrap(d.poolId));
        // DEPLOY_TAG=-fork for local anvil forks, so they never get mistaken for a real deployment
        string memory tag = vm.envOr("DEPLOY_TAG", string(""));
        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), tag, ".json");
        vm.writeJson(json, path);
        console2.log("hook", d.hook);
        console2.log("wrote", path);
    }
}
