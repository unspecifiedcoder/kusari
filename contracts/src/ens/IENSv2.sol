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

/// @notice ENSIP-10 extended resolver. The live ENSv2 PermissionedResolver exposes records ONLY through
/// resolve(dnsName, call), e.g. resolve(name, abi.encodeCall(IENSv2Resolver.data, (node, key))).
interface IENSv2ExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
}

interface IENSv2Owned {
    /// @notice IPermissionedRegistry.getOwner(anyId): accepts a raw labelhash.
    function getOwner(uint256 anyId) external view returns (address);
}

interface IENSv2UniversalResolver {
    function ROOT_REGISTRY() external view returns (address);
}
