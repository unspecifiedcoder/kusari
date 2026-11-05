// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal ENSv2 surfaces Kusari reads on-chain (all view calls, no CCIP-Read).
/// Source: github.com/ensdomains/contracts-v2 (PermissionedRegistry, EnhancedAccessControl, PermissionedResolver).

interface IENSv2Registry {
    function getSubregistry(string calldata label) external view returns (address);
    function getResolver(string calldata label) external view returns (address);
}

interface IENSv2AccessControl {
    function hasRoles(uint256 anyId, uint256 roleBitmap, address account) external view returns (bool);
    function roles(uint256 anyId, address account) external view returns (uint256);
}

interface IENSv2Resolver {
    function data(bytes32 node, string calldata key) external view returns (bytes memory);
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

interface IENSv2Owned {
    /// @notice IPermissionedRegistry.getOwner(anyId): accepts a raw labelhash.
    function getOwner(uint256 anyId) external view returns (address);
}

interface IENSv2UniversalResolver {
    function ROOT_REGISTRY() external view returns (address);
}
