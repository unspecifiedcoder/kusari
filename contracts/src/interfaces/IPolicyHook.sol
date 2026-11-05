// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicySource} from "./IPolicySource.sol";

interface IPolicyHook {
    error NotAuthorized();
    error PolicyInactive();
    error PoolNotAllowed();
    error ExactInputOnly();
    error IntentMismatch();
    error ExceedsPerSwap();
    error ExceedsDaily();
    error PriceImpactTooHigh();
    error BadSignature();
    error Expired();
    error NonceUsed();

    event SwapApproved(address indexed agent, address indexed vault, uint256 amountIn, uint256 spentToday);

    function policySource() external view returns (IPolicySource);
    function spentOn(address agent, uint256 day) external view returns (uint256);
    function nonceUsed(address agent, uint256 nonce) external view returns (bool);
    function domainSeparator() external view returns (bytes32);
}
