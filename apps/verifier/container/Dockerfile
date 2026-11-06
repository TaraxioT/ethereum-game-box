# The verifier's container: a Node server with no build step and no dependencies, and an agent shell as another user.
FROM node:26.13.0-trixie-slim

# jq is for the agent. setpriv and prlimit come with the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends jq \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10000 judge \
  && useradd --uid 10000 --gid judge --no-create-home --shell /usr/sbin/nologin judge \
  && groupadd --gid 10001 agent \
  && useradd --uid 10001 --gid agent --no-create-home --shell /usr/sbin/nologin agent

# Only the server's user can read its code.
WORKDIR /app
COPY --chown=root:judge --chmod=750 package.json ./
COPY --chown=root:judge --chmod=750 src ./src

EXPOSE 8080

# The image starts as root only to leave it: the server runs as `judge`, keeping just the capabilities that `setpriv`
# needs to start the shell as `agent` (see src/sandbox.ts).
ENTRYPOINT ["setpriv", "--reuid=judge", "--regid=judge", "--clear-groups", \
  "--bounding-set=-all,+setuid,+setgid,+setpcap", \
  "--inh-caps=-all,+setuid,+setgid,+setpcap", \
  "--ambient-caps=-all,+setuid,+setgid,+setpcap", \
  "--", "node", "src/main.ts"]
