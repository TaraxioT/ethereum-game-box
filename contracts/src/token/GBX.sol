// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title GBX, the Game Box token
/// @notice Operators stake GBX to run a Box. The whole supply is minted once, to the deployer, who hands it to the
///         launch auction. Nothing can mint more; Buyback burns GBX bought with game fees.
contract GBX is ERC20, ERC20Burnable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Game Box", "GBX") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
