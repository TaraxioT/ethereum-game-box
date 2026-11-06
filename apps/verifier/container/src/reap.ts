// Kills every process the agent owns. The server starts this at the end of each shell call, as its own user.
//
// `kill -1` is what makes that certain: the kernel signals all of them at once, so one that keeps forking can't slip past
// as it could a walk through /proc. It needs the agent's effective ID. That's safe, because the kernel checks a target's
// real and saved IDs and not its effective one: with those as `reaper`, the agent can't kill or freeze this first.
// `reaper` is its own user because a real ID of `judge` would let `kill -1` reach the server too. And this must never
// exec after the switch, which would copy the effective ID into the saved one.
process.setuid!("reaper");
process.seteuid!("agent");
process.kill(-1, "SIGKILL");
