// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPolicySource} from "./interfaces/IPolicySource.sol";
import {Policy} from "./interfaces/PolicyTypes.sol";

/// @title PolicyMirror
/// @notice Owner-controlled policy source. Used on chains where ENS can't be read directly
/// (a relayer mirrors the ENS policy here), and as the safe stand-in before an ENS name is set up.
/// Freezing never depends on the relayer: each agent's owner can freeze it directly, instantly.
contract PolicyMirror is IPolicySource {
    address public admin; // the relayer / deployer: may write policies
    mapping(address agent => address owner) public ownerOf; // the agent's owner: may always freeze
    mapping(address agent => Policy) internal _policies;
    mapping(address agent => bool) internal _authorized;

    event PolicySet(address indexed agent, address indexed owner);
    event Frozen(address indexed agent, address indexed by);
    event Unfrozen(address indexed agent);
    event AdminChanged(address indexed admin);

    error OnlyAdmin();
    error OnlyAdminOrOwner();

    constructor(address _admin) {
        admin = _admin;
    }

    function setAdmin(address next) external {
        if (msg.sender != admin) revert OnlyAdmin();
        admin = next;
        emit AdminChanged(next);
    }

    /// @notice Mirror an agent's policy and authorize it. Admin only.
    function setPolicy(address agent, address owner, Policy calldata p) external {
        if (msg.sender != admin) revert OnlyAdmin();
        ownerOf[agent] = owner;
        _policies[agent] = p;
        _authorized[agent] = true;
        emit PolicySet(agent, owner);
    }

    /// @notice Kill switch. The agent's owner (or the admin) can call it; takes effect on the next swap.
    function freeze(address agent) external {
        if (msg.sender != admin && msg.sender != ownerOf[agent]) revert OnlyAdminOrOwner();
        _authorized[agent] = false;
        emit Frozen(agent, msg.sender);
    }

    function unfreeze(address agent) external {
        if (msg.sender != admin && msg.sender != ownerOf[agent]) revert OnlyAdminOrOwner();
        _authorized[agent] = true;
        emit Unfrozen(agent);
    }

    function policyOf(address agent) external view returns (Policy memory) {
        return _policies[agent];
    }

    function isAuthorized(address agent) external view returns (bool) {
        return _authorized[agent];
    }
}
