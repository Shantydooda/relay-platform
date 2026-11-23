# The Relay Connector, for running inside a buyer's network.
#   docker build -t relay-connector packages/relay-connector
#   docker run --rm -e RELAY_CONNECTOR_KEY=rcn_... \
#     -v /path/to/exports:/exports:ro -v /path/to/settings:/settings \
#     relay-connector --config /settings/relay-connector.json
# Exports are mounted read-only. The container needs outbound HTTPS to Relay only.
FROM node:24-alpine
WORKDIR /opt/relay-connector
COPY package.json README.md ./
COPY src ./src
COPY bin ./bin
USER node
ENTRYPOINT ["node", "/opt/relay-connector/bin/relay-connector.cjs"]
