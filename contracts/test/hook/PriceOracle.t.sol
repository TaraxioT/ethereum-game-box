// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {PriceOracle} from "../../src/hook/PriceOracle.sol";

/// @notice Holds one ring, so the library's storage functions can be called from a test.
contract OracleHarness {
    using PriceOracle for PriceOracle.State;

    PriceOracle.State internal state;

    function initialize(uint32 time) external {
        state.initialize(time);
    }

    function write(uint32 time, int24 tick) external {
        state.write(time, tick);
    }

    function observe(uint32 time, uint32 secondsAgo, int24 tick) external view returns (int56) {
        return state.observe(time, secondsAgo, tick);
    }

    function meanTick(uint32 time, uint32 window, int24 tick) external view returns (int24) {
        return state.meanTick(time, window, tick);
    }
}

/// @notice `PriceOracle` on its own: the ring after it wraps, search, interpolation and rounding.
contract PriceOracleTest is Test {
    uint32 internal constant START = 1_000;
    uint32 internal constant STEP = 10;
    uint256 internal constant WRITES = 600;

    OracleHarness internal oracle;

    function setUp() public {
        oracle = new OracleHarness();
        oracle.initialize(START);
    }

    /// @notice The tick in force from the `k`-th write to the next one: -5 to 5.
    function tickAt(uint256 k) internal pure returns (int24) {
        return int24(int256(k % 11)) - 5;
    }

    /// @notice The running sum at the `i`-th write.
    function sumAt(uint256 i) internal pure returns (int56 sum) {
        for (uint256 k; k < i; ++k) {
            sum += int56(tickAt(k)) * int56(uint56(STEP));
        }
    }

    function fill() internal {
        for (uint256 i = 1; i <= WRITES; ++i) {
            oracle.write(START + uint32(i) * STEP, tickAt(i - 1));
        }
    }

    function test_writesAtMostOncePerSecond() public {
        oracle.write(START + 10, 7);
        oracle.write(START + 10, -100);
        assertEq(oracle.observe(START + 10, 0, 0), 70);
    }

    function test_ringKeepsTheNewest512() public {
        fill();
        uint32 now_ = START + uint32(WRITES) * STEP + 5;
        uint256 oldest = WRITES - PriceOracle.CARDINALITY + 1;
        uint32 oldestTime = START + uint32(oldest) * STEP;

        // Exactly at the oldest observation still held.
        assertEq(oracle.observe(now_, now_ - oldestTime, 0), sumAt(oldest));
        // Between it and the next.
        assertEq(oracle.observe(now_, now_ - oldestTime - 4, 0), sumAt(oldest) + int56(tickAt(oldest)) * 4);
        // One second before it, the ring has written over it.
        vm.expectRevert(abi.encodeWithSelector(PriceOracle.ObservationTooOld.selector, oldestTime - 1, oldestTime));
        oracle.observe(now_, now_ - oldestTime + 1, 0);
    }

    function test_findsEveryObservationAfterTheRingWraps() public {
        fill();
        uint32 now_ = START + uint32(WRITES) * STEP;
        for (uint256 i = WRITES - PriceOracle.CARDINALITY + 1; i <= WRITES; i += 37) {
            uint32 time = START + uint32(i) * STEP;
            assertEq(oracle.observe(now_, now_ - time, 0), sumAt(i));
            assertEq(oracle.observe(now_, now_ - time - 3, 0), sumAt(i) + int56(tickAt(i)) * 3);
        }
    }

    function test_extrapolatesFromTheNewestWithTodaysTick() public {
        fill();
        uint32 last = START + uint32(WRITES) * STEP;
        assertEq(oracle.observe(last + 30, 0, -42), sumAt(WRITES) - 42 * 30);
        assertEq(oracle.observe(last + 30, 10, -42), sumAt(WRITES) - 42 * 20);
    }

    function test_meanTickRoundsDown() public {
        // -1 for 10 seconds, then -2 for 10 seconds: the mean is -1.5, which rounds down to -2.
        oracle.write(START + 10, -1);
        assertEq(oracle.meanTick(START + 20, 20, -2), -2);
        // 1 then 2: 1.5 rounds down to 1.
        oracle.write(START + 20, -2);
        oracle.write(START + 30, 1);
        assertEq(oracle.meanTick(START + 40, 20, 2), 1);
    }

    function test_meanTickRefusesAnEmptyWindow() public {
        vm.expectRevert(PriceOracle.EmptyWindow.selector);
        oracle.meanTick(START + 10, 0, 0);
    }
}
