// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPolicySource} from "../interfaces/IPolicySource.sol";
import {Policy} from "../interfaces/PolicyTypes.sol";
import {IENSv2Registry, IENSv2AccessControl, IENSv2Resolver, IENSv2ExtendedResolver, IENSv2Owned} from "./IENSv2.sol";

/// @title ENSPolicySource
/// @notice Reads an agent's policy and authorization from ENSv2, live, on every swap.
///
/// - Trust root: ONE pinned ENSv2 registry (the parent name's registry, e.g. kusari-demo.eth's), set at deploy.
///   Labels in it can only be created by that name's owner, so nobody can point an agent at a fake registry.
/// - Authorization: the agent holds exactly AUTH_ROLE on its label (e.g. "alpha"). Revoking that role
///   (EnhancedAccessControl.revokeRoles) freezes the agent on its very next swap.
/// - Limits: an ABI-encoded Policy in the label's resolver under the "kusari.policy" data record, read via
///   ENSIP-10 resolve(dnsName, data(node, key)), the only read path the live ENSv2 PermissionedResolver exposes.
///
/// Least privilege: the marker role must not let the agent change its own policy. ROLE_RENEW only lets the
/// holder extend the name's expiry, and the agent must hold nothing else on the label. As a fail-safe, an agent
/// that can repoint the label's resolver (directly, as admin, or as an approved operator) is unauthorized.
contract ENSPolicySource is IPolicySource {
    uint256 public constant ROLE_RENEW = 1 << 16; // RegistryRolesLib.ROLE_RENEW
    uint256 public constant ROLE_SET_RESOLVER = 1 << 24; // RegistryRolesLib.ROLE_SET_RESOLVER
    uint256 public constant AUTH_ROLE = ROLE_RENEW;
    string public constant POLICY_KEY = "kusari.policy";

    /// @notice The only registry this source trusts.
    address public immutable registry;

    struct Binding {
        string label; // e.g. "alpha"
        bytes dnsName; // DNS-encoded "alpha.<name>.eth", for resolve()
        bytes32 node; // namehash("alpha.<name>.eth")
    }

    mapping(address agent => Binding) internal _bindings;

    event AgentBound(address indexed agent, string label, bytes32 node);

    error NotNameOwner();

    constructor(address _registry) {
        registry = _registry;
    }

    /// @notice Link an agent to a label in the pinned registry. Only that label's owner can do this, and an
    /// existing binding can only be replaced by the owner of the label it currently points to.
    /// dnsName/node describe the full name; a wrong value only breaks the binder's own policy (reads come back empty).
    function bind(address agent, string calldata label, bytes calldata dnsName, bytes32 node) external {
        if (_ownerOf(label) != msg.sender) revert NotNameOwner();
        Binding storage current = _bindings[agent];
        if (bytes(current.label).length != 0 && _ownerOf(current.label) != msg.sender) revert NotNameOwner();
        _bindings[agent] = Binding(label, dnsName, node);
        emit AgentBound(agent, label, node);
    }

    function bindingOf(address agent) external view returns (Binding memory) {
        return _bindings[agent];
    }

    function isAuthorized(address agent) external view returns (bool) {
        Binding storage b = _bindings[agent];
        if (bytes(b.label).length == 0) return false;
        IENSv2AccessControl eac = IENSv2AccessControl(registry);
        uint256 id = _labelId(b.label);
        return eac.roles(id, agent) == AUTH_ROLE // exactly the harmless marker role, no admin bits
            && eac.hasRoles(id, AUTH_ROLE, agent)
            && !eac.hasRoles(id, ROLE_SET_RESOLVER, agent); // includes roles inherited as an approved operator
    }

    /// @dev Unbound, no resolver, no record or a failing resolver returns an inactive policy, which the hook rejects.
    function policyOf(address agent) external view returns (Policy memory p) {
        Binding storage b = _bindings[agent];
        if (bytes(b.label).length == 0) return p;
        address resolver = IENSv2Registry(registry).getResolver(b.label);
        if (resolver == address(0)) return p;
        bytes memory call = abi.encodeCall(IENSv2Resolver.data, (b.node, POLICY_KEY));
        try IENSv2ExtendedResolver(resolver).resolve(b.dnsName, call) returns (bytes memory out) {
            if (out.length == 0) return p;
            bytes memory raw = abi.decode(out, (bytes));
            if (raw.length == 0) return p;
            p = abi.decode(raw, (Policy));
        } catch {
            return p;
        }
    }

    function _ownerOf(string memory label) internal view returns (address) {
        return IENSv2Owned(registry).getOwner(_labelId(label));
    }

    function _labelId(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
