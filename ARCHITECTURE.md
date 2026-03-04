# Cloudflare Worker DataKit Architecture

## Overview

This project runs DataKit in a Cloudflare Worker environment to receive and process HTTP request logs from Cloudflare.

```
Cloudflare Domain (Logpush)
         ↓
    HTTP Request Logs
         ↓
Cloudflare Worker
         ↓
   Durable Object (Load Balancing)
         ↓
Container (DataKit + Logstreaming)
         ↓
    TrueWatch Platform
```

## Core Components

### 1. Cloudflare Logpush
- **Function**: Pushes HTTP request logs from Cloudflare domain to the Worker
- **Configuration**: Configure the push destination as a custom domain in Cloudflare Dashboard's Logpush settings
- **Request Parameters**:
  - source: cf-logpush-worker
  - service: domain-httprequest(helloworld.com-httprequest)
  - type: firelens
  - token: Your TrueWatch Workspace Token

### 2. Cloudflare Worker
- **Function**: Receives log requests and routes them to container instances
- **Load Balancing**: Implements load balancing across multiple container instances via Durable Objects
- **Version Control**: Supports blue-green deployment, automatically routing to new version containers on each deployment

### 3. Durable Object (DataKit)
- **Function**: Manages container lifecycle and request proxying
- **Container Management**: Automatic startup, shutdown, and health checks
- **Request Processing**:
  - Decompresses requests (gzip/deflate)
  - Format conversion (supports JSON, NDJSON formats)
  - Forwards requests to DataKit inside the container

### 4. Container (DataKit)
- **Base Image**: `pubrepo.truewatch.com/datakit/datakit`
- **Logstreaming**: Receives logs via `/v1/write/logstreaming` endpoint
- **Data Collection**: Built-in collectors (CPU, memory, network, logs, etc.)
- **Data Reporting**: Reports to TrueWatch via the address configured in `ENV_DATAWAY`

### 5. TrueWatch Platform
- **Function**: Receives and stores logs and monitoring data from DataKit
- **Endpoint**: Configured via `ENV_DATAWAY` environment variable

## Data Flow

1. **Log Generation**: Cloudflare generates HTTP request logs
2. **Log Push**: Logs are pushed to the Worker's custom domain via Logpush
3. **Request Routing**: Worker selects a container instance through load balancing
4. **Format Processing**: Durable Object processes request format (decompress, convert)
5. **Log Reception**: DataKit inside the container receives logs via logstreaming
6. **Data Reporting**: DataKit reports logs to the TrueWatch platform

## Key Features

- **Elastic Scaling**: Supports multiple container instances with automatic load balancing
- **Auto Sleep**: Containers automatically stop after idle timeout, saving resources
- **Format Compatibility**: Supports multiple log formats (JSON Array, single JSON, NDJSON)
- **Blue-Green Deployment**: Automatically creates new version containers on each deployment for smooth transitions
- **High Availability**: Containers automatically restart on failures, avoiding single points of failure

## Configuration

### Core Configuration Items

- **MAX_CONTAINER_INSTANCES**: Maximum number of container instances (for load balancing)
- **ENV_DATAWAY**: TrueWatch platform reporting address (Secret)
- **ENV_HOSTNAME**: DataKit host identifier
- **ENV_SLEEP_AFTER**: Container idle timeout duration
- **Custom Domain**: Domain address for receiving Logpush

For detailed configuration instructions, please refer to [README.md](./README.md).

