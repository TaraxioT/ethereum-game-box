// Kills every process the agent owns. The server starts this at the end of each shell call, as its own user.
//
// `kill -1` is what makes that certain: the kernel signals all of them at once, so one that keeps forking can't slip past
// as it could a walk through /proc. It needs the agent's effective ID, but that alone is safe. A process can signal
// another only through its real or saved ID, so with those as `reaper`, the agent can't kill or freeze this one first.
// `reaper` is its own user because `kill -1` would reach the server too from a real ID of `judge`. And this must never
// exec after the switch, which would copy the effective ID into the saved one.
process.setuid!("reaper");
process.seteuid!("agent");
process.kill(-1, "SIGKILL");
