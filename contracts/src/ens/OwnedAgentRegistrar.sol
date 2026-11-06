// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IOwnedNameRegistry {
    function register(string calldata label, address owner, address subregistry, address resolver, uint256 roles, uint64 expiry)
        external returns (uint256);
}

/// @notice Permissionless registration of deterministic agent labels in Kusari's ENSv2 namespace.
/// @dev This contract receives ONLY the parent registry's ROLE_REGISTRAR (bit 0), with no admin bits.
/// It cannot edit policies, grant/revoke agent roles, withdraw funds or administer existing names.
/// The namespace's parent administrator remains an ENS trust root; this does not remove that authority.
contract OwnedAgentRegistrar {
    IOwnedNameRegistry public immutable registry;
    uint256 public constant OWNER_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint64 public constant REGISTRATION_DURATION = 365 days;

    event AgentNameClaimed(address indexed owner, address indexed agent, address indexed resolver, string label);
    error InvalidAgent();
    error InvalidResolver();

    constructor(IOwnedNameRegistry _registry) {
        registry = _registry;
    }

    /// @notice A separate label for every owner/agent pair; another owner cannot front-run your label.
    function labelFor(address owner, address agent) public pure returns (string memory) {
        bytes20 digest = bytes20(keccak256(abi.encode(owner, agent)));
        bytes memory chars = new bytes(42);
        chars[0] = "a";
        chars[1] = "-";
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            chars[2 + i * 2] = alphabet[uint8(digest[i]) >> 4];
            chars[3 + i * 2] = alphabet[uint8(digest[i]) & 15];
        }
        return string(chars);
    }

    /// @notice The connected owner receives the ENS label directly. Further setup is owner-signed.
    function claim(address agent, address resolver) external returns (string memory label) {
        if (agent == address(0) || agent == msg.sender) revert InvalidAgent();
        if (resolver.code.length == 0) revert InvalidResolver();
        label = labelFor(msg.sender, agent);
        registry.register(label, msg.sender, address(0), resolver, OWNER_ROLES, uint64(block.timestamp) + REGISTRATION_DURATION);
        emit AgentNameClaimed(msg.sender, agent, resolver, label);
    }
}
