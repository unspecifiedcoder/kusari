import { parseAbi } from "viem";

export const factoryAbi = parseAbi([
  "function create(address agent) returns (address)",
  "function vaultsOf(address owner) view returns (address[])",
  "event VaultCreated(address indexed owner, address indexed vault, address indexed agent)",
]);

export const vaultAbi = parseAbi([
  "function owner() view returns (address)",
  "function agent() view returns (address)",
  "function withdraw(address currency, address to, uint256 amount)",
  "error OnlyOwner()",
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)", // test tokens only
]);
