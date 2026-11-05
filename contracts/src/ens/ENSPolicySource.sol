// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPolicySource} from "../interfaces/IPolicySource.sol";
import {Policy} from "../interfaces/PolicyTypes.sol";
import {IENSv2Registry, IENSv2AccessControl, IENSv2Resolver, IENSv2Owned} from "./IENSv2.sol";

/// @title ENSPolicySource
/// @notice Reads an agent's policy and authorization from ENSv2, live, on every swap.
///
/// - Authorization: the agent holds AUTH_ROLE on its label (e.g. "alpha") in the parent name's registry.
///   Revoking that role (EnhancedAccessControl.revokeRoles) freezes the agent on its very next swap.
/// - Limits: an ABI-encoded Policy in the label's resolver, under data(node, "kusari.policy").
///
/// Least privilege: the marker role must not let the agent change its own policy. ROLE_RENEW only lets the
/// holder extend the name's expiry. As a fail-safe, an agent that can change the label's resolver
/// (directly or as an approved operator, which inherits the owner's roles) is treated as unauthorized.
contract ENSPolicySource is IPolicySource {
    uint256 public constant ROLE_RENEW = 1 << 16; // RegistryRolesLib.ROLE_RENEW
    uint256 public constant ROLE_SET_RESOLVER = 1 << 24; // RegistryRolesLib.ROLE_SET_RESOLVER
    uint256 public constant AUTH_ROLE = ROLE_RENEW;
    string public constant POLICY_KEY = "kusari.policy";

    struct Binding {
        address registry; // the parent name's registry, e.g. <name>.eth's subregistry
        string label; // e.g. "alpha"
        bytes32 node; // namehash("alpha.<name>.eth"), used for resolver records
    }

    mapping(address agent => Binding) internal _bindings;

    event AgentBound(address indexed agent, address indexed registry, string label, bytes32 node);

    error NotNameOwner();

    /// @notice Link an agent to an ENS label. Only the label's current owner can do this.
    function bind(address agent, address registry, string calldata label, bytes32 node) external {
        if (IENSv2Owned(registry).getOwner(_labelId(label)) != msg.sender) revert NotNameOwner();
        _bindings[agent] = Binding(registry, label, node);
        emit AgentBound(agent, registry, label, node);
    }

    function bindingOf(address agent) external view returns (Binding memory) {
        return _bindings[agent];
    }

    function isAuthorized(address agent) external view returns (bool) {
        Binding storage b = _bindings[agent];
        if (b.registry == address(0)) return false;
        IENSv2AccessControl eac = IENSv2AccessControl(b.registry);
        uint256 id = _labelId(b.label);
        return eac.hasRoles(id, AUTH_ROLE, agent) && !eac.hasRoles(id, ROLE_SET_RESOLVER, agent);
    }

    /// @dev Unbound, no resolver or no record returns an inactive policy, which the hook rejects.
    function policyOf(address agent) external view returns (Policy memory p) {
        Binding storage b = _bindings[agent];
        if (b.registry == address(0)) return p;
        address resolver = IENSv2Registry(b.registry).getResolver(b.label);
        if (resolver == address(0)) return p;
        bytes memory raw = IENSv2Resolver(resolver).data(b.node, POLICY_KEY);
        if (raw.length == 0) return p;
        p = abi.decode(raw, (Policy));
    }

    function _labelId(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
