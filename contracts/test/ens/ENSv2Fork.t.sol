// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {
    IENSv2Registry, IENSv2AccessControl, IENSv2UniversalResolver
} from "../../src/ens/IENSv2.sol";

/// Fork test against the live ENSv2 deployment on Sepolia.
/// Proves a contract can walk the registry tree with plain view calls.
contract ENSv2ForkTest is Test {
    address constant ROOT_REGISTRY = 0xB458D6a3a77919449d03e7A6903C26827c1eC43f;
    address constant ETH_REGISTRY = 0xD4eBcbBdF463C9c45784603Db0dDD499BC44A8B4;
    address constant UNIVERSAL_RESOLVER = 0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe;

    function setUp() public {
        vm.createSelectFork(vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com")));
        // public RPCs are load-balanced; pin a few blocks back so every backend has the state
        vm.rollFork(block.number - 8);
    }

    function test_universalResolver_pointsAtLiveRoot() public view {
        assertEq(IENSv2UniversalResolver(UNIVERSAL_RESOLVER).ROOT_REGISTRY(), ROOT_REGISTRY);
    }

    function test_root_resolvesEthSubregistry() public view {
        assertEq(IENSv2Registry(ROOT_REGISTRY).getSubregistry("eth"), ETH_REGISTRY);
    }

    function test_accessControl_isReadableOnChain() public view {
        uint256 ethLabel = uint256(keccak256(bytes("eth")));
        // a random account holds no roles; the call itself must succeed as a plain view
        assertEq(IENSv2AccessControl(ROOT_REGISTRY).roles(ethLabel, address(0xBEEF)), 0);
        assertFalse(IENSv2AccessControl(ROOT_REGISTRY).hasRoles(ethLabel, 1, address(0xBEEF)));
    }
}
