FROM node:24-alpine

ARG PACKAGE=@m-sanchez/calibration-explorer-mcp@0.2.0
RUN npm install --global --no-audit --no-fund "$PACKAGE" \
 && npm cache clean --force \
 && mkdir -p /data/input /data/output \
 && chown node:node /data/output

USER node
WORKDIR /data
ENTRYPOINT ["calibration-explorer-mcp"]
CMD ["--input-root", "/data/input", "--output-root", "/data/output"]
