# The verifier's container: a Node server with no build step and no dependencies, and an agent shell as another user.
FROM node:26.13.0-trixie-slim

# jq is for the agent. setpriv and prlimit come with the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends jq tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10000 judge \
  && useradd --uid 10000 --gid judge --no-create-home --shell /usr/sbin/nologin judge \
  && groupadd --gid 10001 agent \
  && useradd --uid 10001 --gid agent --no-create-home --shell /usr/sbin/nologin agent \
  && groupadd --gid 10002 reaper \
  && useradd --uid 10002 --gid reaper --no-create-home --shell /usr/sbin/nologin reaper \
  && install -d -o root -g judge -m 750 /app

# Only the server's user can list or read its code.
WORKDIR /app
COPY --chown=root:judge --chmod=750 package.json ./
COPY --chown=root:judge --chmod=750 src ./src

EXPOSE 8080

# The image starts as root only to leave it: everything runs as `judge`, keeping just the capabilities `setpriv` needs
# to start the shell as `agent` (see src/sandbox.ts). tini reaps what the agent leaves behind, which Node wouldn't, and
# zombies count against the shell's process limit. `-s` keeps that working if the platform makes something else PID 1.
ENTRYPOINT ["setpriv", "--reuid=judge", "--regid=judge", "--clear-groups", \
  "--bounding-set=-all,+setuid,+setgid,+setpcap", \
  "--inh-caps=-all,+setuid,+setgid,+setpcap", \
  "--ambient-caps=-all,+setuid,+setgid,+setpcap", \
  "--", "tini", "-s", "--", "node", "src/main.ts"]
