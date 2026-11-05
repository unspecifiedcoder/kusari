// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stands in for ENSv2 PermissionedResolver's data()/text() reads in fork tests.
contract MockDataResolver {
    mapping(bytes32 node => mapping(string key => bytes value)) internal _data;

    function setData(bytes32 node, string calldata key, bytes calldata value) external {
        _data[node][key] = value;
    }

    function data(bytes32 node, string calldata key) external view returns (bytes memory) {
        return _data[node][key];
    }

    function text(bytes32, string calldata) external pure returns (string memory) {
        return "";
    }
}
