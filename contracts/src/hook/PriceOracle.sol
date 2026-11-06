// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title PriceOracle
/// @notice A time-weighted average of a pool's tick, kept as a ring of `CARDINALITY` observations of the running sum
///         `tick × seconds`. The average tick over any window is the difference of two sums divided by the window.
/// @dev Times are `uint32` seconds, so this works until 2106. At most one observation is written per block, holding
///      the tick in force before that block's first swap, so a price pushed within one block counts for zero seconds.
library PriceOracle {
    /// @notice How many observations the ring holds.
    uint16 internal constant CARDINALITY = 512;

    /// @notice The window reaches back before the oldest observation the ring still holds.
    error ObservationTooOld(uint32 target, uint32 oldest);
    /// @notice A window of zero seconds has no average.
    error EmptyWindow();

    /// @notice The running sum at one moment.
    /// @param time When it was written.
    /// @param tickCumulative The sum of `tick × seconds` from the first observation until `time`.
    /// @param initialized Whether this slot holds an observation.
    struct Observation {
        uint32 time;
        int56 tickCumulative;
        bool initialized;
    }

    /// @notice The ring.
    /// @param index The slot of the newest observation.
    /// @param observations The slots.
    struct State {
        uint16 index;
        Observation[CARDINALITY] observations;
    }

    /// @notice Writes the first observation, at `time`.
    function initialize(State storage self, uint32 time) internal {
        self.index = 0;
        self.observations[0] = Observation({time: time, tickCumulative: 0, initialized: true});
    }

    /// @notice Writes an observation at `time`, with `tick` the tick in force since the newest one. Does nothing if
    ///         the newest one is already at `time`.
    function write(State storage self, uint32 time, int24 tick) internal {
        Observation memory last = self.observations[self.index];
        if (last.time == time) return;
        uint16 next = (self.index + 1) % CARDINALITY;
        self.observations[next] = _transform(last, time, tick);
        self.index = next;
    }

    /// @notice The running sum `secondsAgo` before `time`, with `tick` the pool's tick now.
    function observe(State storage self, uint32 time, uint32 secondsAgo, int24 tick)
        internal
        view
        returns (int56 tickCumulative)
    {
        uint32 target = time - secondsAgo;
        Observation memory last = self.observations[self.index];
        // At or after the newest observation the tick has been `tick` all along.
        if (target >= last.time) return _transform(last, target, tick).tickCumulative;

        uint16 oldestIndex = (self.index + 1) % CARDINALITY;
        if (!self.observations[oldestIndex].initialized) oldestIndex = 0;
        Observation memory oldest = self.observations[oldestIndex];
        if (target < oldest.time) revert ObservationTooOld(target, oldest.time);

        (Observation memory before, Observation memory after_) = _search(self, oldestIndex, target);
        if (before.time == target) return before.tickCumulative;
        // The tick was constant between two observations, so the sum grows linearly between them.
        int56 rate = (after_.tickCumulative - before.tickCumulative) / int56(uint56(after_.time - before.time));
        return before.tickCumulative + rate * int56(uint56(target - before.time));
    }

    /// @notice The average tick over the last `window` seconds before `time`, rounded down.
    function meanTick(State storage self, uint32 time, uint32 window, int24 tick) internal view returns (int24) {
        if (window == 0) revert EmptyWindow();
        int56 delta = observe(self, time, 0, tick) - observe(self, time, window, tick);
        int56 mean = delta / int56(uint56(window));
        if (delta < 0 && delta % int56(uint56(window)) != 0) mean--;
        return int24(mean);
    }

    /// @notice The newest observation at or before `target`, and the one after it. `target` lies at or after the
    ///         oldest observation and before the newest.
    function _search(State storage self, uint16 oldestIndex, uint32 target)
        private
        view
        returns (Observation memory before, Observation memory after_)
    {
        // Positions count from the oldest observation; the newest is at `count - 1`.
        uint256 count = (uint256(self.index) + CARDINALITY - oldestIndex) % CARDINALITY + 1;
        uint256 lo = 0;
        uint256 hi = count - 1;
        // Invariant: position `lo` is at or before `target`, position `hi` after it.
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            if (self.observations[(oldestIndex + mid) % CARDINALITY].time <= target) lo = mid;
            else hi = mid;
        }
        before = self.observations[(oldestIndex + lo) % CARDINALITY];
        after_ = self.observations[(oldestIndex + hi) % CARDINALITY];
    }

    function _transform(Observation memory last, uint32 time, int24 tick) private pure returns (Observation memory) {
        return Observation({
            time: time,
            tickCumulative: last.tickCumulative + int56(tick) * int56(uint56(time - last.time)),
            initialized: true
        });
    }
}
