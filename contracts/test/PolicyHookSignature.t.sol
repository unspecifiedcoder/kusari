// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

import {KusariFixture} from "./utils/KusariFixture.sol";
import {IPolicyHook} from "../src/interfaces/IPolicyHook.sol";
import {SwapIntent} from "../src/interfaces/PolicyTypes.sol";

contract PolicyHookSignatureTest is KusariFixture {
    address vault;

    function setUp() public {
        _setUpKusari();
        vault = address(swapRouter);
        source.setAuthorized(agent, true);
        source.setPolicy(agent, _policy({maxPerSwap: 1e18, dailyCap: 10e18, maxImpactBps: 10_000}));
    }

    function test_validSignature_consumesNonce() public {
        _swapSigned(_intent(agent, vault, 1e18, 7));
        assertTrue(hook.nonceUsed(agent, 7));
    }

    function test_wrongSigner_reverts() public {
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.BadSignature.selector));
        _routerSwap(i, _sign(attackerPk, i));
    }

    function test_missingSignature_reverts() public {
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.BadSignature.selector));
        _routerSwap(_intent(agent, vault, 1e18, 0), "");
    }

    function test_signatureForDifferentAmount_reverts() public {
        SwapIntent memory signed = _intent(agent, vault, 0.5e18, 0);
        bytes memory sig = _sign(agentPk, signed);
        SwapIntent memory tampered = _intent(agent, vault, 1e18, 0);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.BadSignature.selector));
        _routerSwap(tampered, sig);
    }

    function test_replayedNonce_reverts() public {
        SwapIntent memory i = _intent(agent, vault, 0.5e18, 0);
        bytes memory sig = _sign(agentPk, i);
        _routerSwap(i, sig);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.NonceUsed.selector));
        _routerSwap(i, sig);
    }

    function test_expiredIntent_reverts() public {
        SwapIntent memory i = _intent(agent, vault, 1e18, 0);
        bytes memory sig = _sign(agentPk, i);
        vm.warp(i.deadline + 1);
        _expectHookRevert(IHooks.beforeSwap.selector, abi.encodeWithSelector(IPolicyHook.Expired.selector));
        _routerSwap(i, sig);
    }

    function test_domainSeparator_matchesSharedTypes() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Kusari"),
                keccak256("1"),
                block.chainid,
                address(hook)
            )
        );
        assertEq(hook.domainSeparator(), expected);
    }
}
