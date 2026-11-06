// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ENSPolicySource} from "./ENSPolicySource.sol";
import {PersonalAgentVaultFactory} from "../PersonalAgentVaultFactory.sol";
import {Policy} from "../interfaces/PolicyTypes.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

struct AtomicEACGrant { address account; uint256 roleBitmap; }
interface IAtomicENSRegistry {
    function register(string calldata label, address owner, address subregistry, address resolver, uint256 roleBitmap, uint64 expiry) external returns (uint256);
    function grantRoles(uint256 anyId, uint256 bitmap, address account) external returns (bool);
    function getTokenId(uint256 anyId) external view returns (uint256);
    function unsafeTransfer(address to, uint256 id, bytes calldata data) external;
}
interface IAtomicResolver {
    function initialize(AtomicEACGrant[] calldata grants, bytes[] calldata calls) external;
    function setData(bytes calldata name, string calldata key, bytes calldata value) external;
    function grantRootRoles(uint256 bitmap, address account) external returns (bool);
    function revokeRootRoles(uint256 bitmap, address account) external returns (bool);
}
interface IAtomicProxyFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}
interface IAtomicTestToken { function mint(address to, uint256 amount) external; }

/// @notice One owner transaction creates a personal ENS policy, restricted agent and owner-held vault.
/// @dev ENS registration and resolver initialization temporarily use this contract, then transfer ALL
/// label rights to the user and erase ALL resolver rights before returning. Only register-only parent
/// authority remains. The parent's own administrator is still the namespace's ENS trust root.
contract OwnedAgentCoordinator is IERC1155Receiver {
    uint256 public constant ALL = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 public constant AUTH_ROLE = 1 << 16;
    uint256 public constant MAX_AGENT_GAS = 0.001 ether;
    uint256 public constant TEST_FUNDING = 25 ether;
    IAtomicENSRegistry public immutable registry;
    ENSPolicySource public immutable policySource;
    IAtomicProxyFactory public immutable proxyFactory;
    address public immutable resolverImplementation;
    PersonalAgentVaultFactory public immutable vaultFactory;
    IAtomicTestToken public immutable fundingToken;
    PoolId public immutable allowedPool;
    bytes public parentDns;
    bytes32 public immutable parentNode;
    bool private _entered;

    struct Workspace { address vault; address resolver; string label; }
    mapping(address owner => mapping(address agent => Workspace)) private _workspaces;
    event WorkspaceCreated(address indexed owner, address indexed agent, address indexed vault, address resolver, string label, uint256 agentGas);
    error InvalidAgent();
    error InvalidPolicy();
    error InvalidGasFunding();
    error AlreadyCreated();
    error ReentrantCall();
    error GasFundingFailed();

    constructor(address _registry, address _source, address _proxyFactory, address _resolverImpl,
        address _vaultFactory, address _fundingToken, PoolId _pool, bytes memory _parentDns, bytes32 _parentNode)
    {
        registry = IAtomicENSRegistry(_registry);
        policySource = ENSPolicySource(_source);
        proxyFactory = IAtomicProxyFactory(_proxyFactory);
        resolverImplementation = _resolverImpl;
        vaultFactory = PersonalAgentVaultFactory(_vaultFactory);
        fundingToken = IAtomicTestToken(_fundingToken);
        allowedPool = _pool;
        parentDns = _parentDns;
        parentNode = _parentNode;
    }

    function labelFor(address owner, address agent) public pure returns (string memory) {
        bytes20 digest = bytes20(keccak256(abi.encode(owner, agent)));
        bytes memory chars = new bytes(42);
        chars[0] = "a"; chars[1] = "-";
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            chars[2 + i * 2] = alphabet[uint8(digest[i]) >> 4];
            chars[3 + i * 2] = alphabet[uint8(digest[i]) & 15];
        }
        return string(chars);
    }

    function workspaceOf(address owner, address agent) external view returns (address vault, address resolver, string memory label) {
        Workspace storage w = _workspaces[owner][agent];
        return (w.vault, w.resolver, w.label);
    }

    function create(address agent, uint128 maxPerSwap, uint128 dailyCap, uint16 maxImpactBps)
        external payable returns (address vault, address resolver, string memory label)
    {
        if (_entered) revert ReentrantCall();
        _entered = true;
        if (agent == address(0) || agent == msg.sender || agent == address(this)) revert InvalidAgent();
        if (maxPerSwap == 0 || dailyCap < maxPerSwap || maxImpactBps == 0 || maxImpactBps > 10000) revert InvalidPolicy();
        if (msg.value > MAX_AGENT_GAS) revert InvalidGasFunding();
        if (_workspaces[msg.sender][agent].vault != address(0)) revert AlreadyCreated();
        label = labelFor(msg.sender, agent);
        resolver = _createPolicy(agent, label, maxPerSwap, dailyCap, maxImpactBps);
        vault = address(vaultFactory.createFor(msg.sender, agent));
        fundingToken.mint(vault, TEST_FUNDING);
        _workspaces[msg.sender][agent] = Workspace(vault, resolver, label);
        if (msg.value != 0) {
            (bool sent,) = payable(agent).call{value: msg.value}("");
            if (!sent) revert GasFundingFailed();
        }
        _entered = false;
        emit WorkspaceCreated(msg.sender, agent, vault, resolver, label, msg.value);
    }

    function _createPolicy(address agent, string memory label, uint128 maxPerSwap, uint128 dailyCap, uint16 impact)
        internal returns (address resolver)
    {
        AtomicEACGrant[] memory grants = new AtomicEACGrant[](1);
        grants[0] = AtomicEACGrant(address(this), ALL);
        uint256 salt = uint256(keccak256(abi.encode(msg.sender, agent)));
        resolver = proxyFactory.deployProxy(resolverImplementation, salt,
            abi.encodeCall(IAtomicResolver.initialize, (grants, new bytes[](0))));
        registry.register(label, address(this), address(0), resolver, ALL, uint64(block.timestamp + 365 days));
        bytes memory dns = abi.encodePacked(bytes1(uint8(bytes(label).length)), label, parentDns);
        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        IAtomicResolver(resolver).setData(dns, "kusari.policy", abi.encode(Policy(maxPerSwap, dailyCap, impact, allowedPool, true)));
        policySource.bind(agent, label, dns, node);
        uint256 labelId = uint256(keccak256(bytes(label)));
        registry.grantRoles(labelId, AUTH_ROLE, agent);
        // grantRoles regenerates the ERC1155 token ID. Resolve the CURRENT token after granting.
        // ENS's documented transfer for a known, non-emancipated namespace and retained agent marker.
        // The ordinary safeTransfer rejects both parent admin rights and any delegated role. This
        // intentional new-name handoff preserves the known parent trust root and AUTH_ROLE only.
        // Owner approval and ROLE_CAN_TRANSFER_ADMIN are still enforced by the registry.
        registry.unsafeTransfer(msg.sender, registry.getTokenId(labelId), "");
        // Resolver root admin is independent of ENS label ownership; explicitly transfer and erase it.
        IAtomicResolver(resolver).grantRootRoles(ALL, msg.sender);
        IAtomicResolver(resolver).revokeRootRoles(ALL, address(this));
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(registry));
        return IERC1155Receiver.onERC1155Received.selector;
    }
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(registry));
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
    }
}
