// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @notice Limits an agent must respect. Amounts are in units of the swap's input token.
struct Policy {
    uint128 maxPerSwap;
    uint128 dailyCap;
    uint16 maxImpactBps;
    PoolId allowedPool;
    bool active;
}

/// @notice What the agent signs (EIP-712). The hook checks it on every swap.
struct SwapIntent {
    address agent;
    address vault;
    PoolId poolId;
    bool zeroForOne;
    uint256 amountIn;
    uint256 nonce;
    uint256 deadline;
}

library PolicyTypes {
    bytes32 internal constant SWAP_INTENT_TYPEHASH = keccak256(
        "SwapIntent(address agent,address vault,bytes32 poolId,bool zeroForOne,uint256 amountIn,uint256 nonce,uint256 deadline)"
    );

    function hash(SwapIntent memory i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SWAP_INTENT_TYPEHASH, i.agent, i.vault, i.poolId, i.zeroForOne, i.amountIn, i.nonce, i.deadline
            )
        );
    }
}
