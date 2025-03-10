# CKB Asset-specified Indexer

A comprehensive solution for developers to interact with CKB network assets (UDT tokens and DOB NFTs) through simplified interfaces. This project serves as both an asset explorer with reorg feature supported and a global state tracker for sUDT/xUDT and Spore protocols.

This project provides a streamlined API for accessing and managing assets on the CKB network, with built-in support for the rgb++ protocol. It's designed with modularity in mind, allowing individual components to run as independent microservices to meet varying throughput requirements.

## Architecture

The application is built on Next.js and follows a modular microservice architecture:

### Core Modules

1. **Asset Service** (`libs/asset`)

   - Handles interaction with CKB cells containing UDT and DOB assets
   - Provides methods for token identification, balance calculation, and ownership verification
   - Supports various token standards including sUDT and xUDT with RGB++ assets supported

2. **Sync Service** (`libs/sync`)

   - Manages blockchain synchronization with configurable parameters
   - Processes blocks in chunks with multi-threading support
   - Handles transaction caching and database management
   - Implements automatic clearing processes with configurable confirmations

3. **Block Service** (`libs/block`)

   - Provides access to blockchain data at the block level
   - Supports efficient querying of historical block data

4. **Cell Service** (`libs/cell`)

   - Tracks cell creation, consumption, and state changes
   - Provides efficient lookup for cells by various criteria
   - Supports complex cell queries with filtering capabilities

5. **Spore Service** (`libs/spore`)

   - Provides metadata extraction and content resolution
   - Supports Spore-specific queries and filtering

6. **UDT Service** (`libs/udt`)

   - Dedicated to User-Defined Token management
   - Tracks token issuance, mints, transfers, burns and balances
   - Supports multiple UDT standards (sUDT, xUDT)
   - Provides a overview of token and its holders information

### Supporting Services

- **DOB Decoder Server**: A standalone server for parsing on-chain spores under DOB protocol
- **SSRI Server**: A standalone server for extracting SSRI information

## Setup and Deployment

### Prerequisites

- Docker and Docker Compose
- At least 8GB RAM for optimal performance
- Sufficient disk space for MySql data

### Quick Start

1. Clone the repository:

   ```bash
   $ git clone https://github.com/ckb-devrel/ckb-indexer.git
   $ cd ckb-indexer
   ```

2. Start the services using Docker Compose:

   ```bash
   $ docker compose build
   $ docker compose up -d
   $ docker compose logs -f
   ```

3. Access the Swagger API documentation:
   ```
   http://localhost:8080/docs
   ```

### Configuration

The application uses YAML configuration files located in the `config` directory:

- For testnet: `config/config.yaml`
- For mainnet: `config.mainnet/config.yaml`

note: `config.dob-decoder.toml` and `config.ssri-server.toml` files keeping the same is fine.

## Notes

1. After the first startup, the indexer needs to synchronize from the initialization block specified in the configuration (key `blockSyncStart`). According to your runtime environment, this process may take 3-4 days to complete.

2. Depending on your machine's specifications, JavaScript GC issues might be encountered during synchronization. If this happens, please adjust the configuration parameters that could lead to high memory usage according to the comments in the configuration file (such as `blockChunk` and `maxConcurrent`).
