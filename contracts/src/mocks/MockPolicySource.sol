// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicySource} from "../interfaces/IPolicySource.sol";
import {Policy} from "../interfaces/PolicyTypes.sol";

/// @notice Stand-in for ENSPolicySource in tests and local runs.
contract MockPolicySource is IPolicySource {
    mapping(address => Policy) internal _policies;
    mapping(address => bool) public authorized;

    function setPolicy(address agent, Policy calldata p) external {
        _policies[agent] = p;
    }

    function setAuthorized(address agent, bool ok) external {
        authorized[agent] = ok;
    }

    function policyOf(address agent) external view returns (Policy memory) {
        return _policies[agent];
    }

    function isAuthorized(address agent) external view returns (bool) {
        return authorized[agent];
    }
}
