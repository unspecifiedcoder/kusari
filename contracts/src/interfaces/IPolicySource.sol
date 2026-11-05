// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Policy} from "./PolicyTypes.sol";

/// @notice Where the hook reads an agent's policy from.
/// ENSPolicySource (Sepolia), PolicyMirror (other chains) and MockPolicySource (tests) implement this.
interface IPolicySource {
    function policyOf(address agent) external view returns (Policy memory);
    function isAuthorized(address agent) external view returns (bool);
}
