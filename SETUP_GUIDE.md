# DataKit running in Cloudflare Worker

## Prerequisites

- Cloudflare account with access to Workers, Containers, and Container Registry
- VS Code or IDE that supports devcontainers
- Docker (included in devcontainer)

## Development Environment Setup

### Using Devcontainer

1. Open the project in VS Code
2. Click "Reopen in Container" when prompted
3. The devcontainer includes Node.js LTS, Wrangler CLI, pnpm, and Docker-in-Docker

### Install Dependencies

```bash
npm install
# or
pnpm install
```

### Cloudflare Authentication

```bash
wrangler login
```

### Generate TypeScript Types

```bash
npm run cf-typegen
```

**Generates `worker-configuration.d.ts` from `wrangler.jsonc`. Run after modifying `wrangler.jsonc` or updating Wrangler.**

## DataKit Configuration

### Find DataKit Version and ENV_DATAWAY

Before downloading the DataKit image, you need to find the latest version number and the `ENV_DATAWAY` value. Both can be found in the same location.

To find the latest DataKit version and `ENV_DATAWAY`:

1. Log in to your TrueWatch Platform workspace

2. Click **"Integration"** on the left sidebar

3. Select **"DataKit"** at the top

4. You will see installation commands for various platforms

5. Under the **Docker** section, you can see:

   - The latest version of the image in the docker command (e.g., `pubrepo.truewatch.com/datakit/datakit:1.86.0` where `1.86.0` is the version)

   - The `ENV_DATAWAY` environment variable value (the complete URL with token, e.g., `https://your_site-openway.truewatch.com?token=your_token_here`)

**Important:** The `ENV_DATAWAY` URL differs for each workspace. Always use the complete URL (including the domain) provided in your TrueWatch Platform workspace, not just replace the token in a generic example.

Save both the version number and the complete `ENV_DATAWAY` value as you'll need them for configuration.

## Initial Setup

### Copy Template File

Start by copying the template file to create your `wrangler.jsonc`:

```bash
cp wrangler.jsonc.template wrangler.jsonc
```

### Replace Placeholders

Open `wrangler.jsonc` and replace the following placeholders with your actual values:

1. **`{{PROJECT_NAME}}`** - Replace in three locations:
   - `name` (top-level)
   - `vars.ENV_HOSTNAME`
   - `containers[0].name`
   
   Example: If your project is `datakit-myproject`, replace all three occurrences.

2. **`{{YOUR_CUSTOM_DOMAIN}}`** - Replace in:
   - `routes[0].pattern`
   
   Example: `dk-myproject.truewatch.info`

3. **`{{MAX_CONTAINER_INSTANCES}}`** - Replace in:
   - `vars.MAX_CONTAINER_INSTANCES`
   
   Example: `"2"` for 2 container instances

4. **`{{MAX_INSTANCES}}`** - Replace in:
   - `containers[0].max_instances`
   
   **IMPORTANT:** 
   - This value must be **twice** the value of `MAX_CONTAINER_INSTANCES`. For example:
     - If `MAX_CONTAINER_INSTANCES` is `"2"`, then `max_instances` should be `4`
     - If `MAX_CONTAINER_INSTANCES` is `"3"`, then `max_instances` should be `6`
   - **Note:** `max_instances` is a **number** (not a string) in JSON. Use `4` not `"4"`.
   - This relationship is required for deployment. See [Container Instance Configuration](#container-instance-configuration) for details.

5. **`{{CONTAINER_IMAGE}}`** - Replace in:
   - `containers[0].image`
   
   This should be the full URL of your pushed Docker image from Cloudflare Container Registry (e.g., `registry.cloudflare.com/YOUR_ACCOUNT_ID/truewatch/datakit:1.86.0`). See [Configure Container Image](#configure-container-image) below for instructions on downloading from TrueWatch and pushing to Cloudflare Registry.

## Configuration

### Configure Project Name

This is already covered in [Initial Setup](#initial-setup) above. Replace `{{PROJECT_NAME}}` in three locations:
- `name` (top-level)
- `vars.ENV_HOSTNAME`
- `containers[0].name`

### Configure Container Image

You need to download the DataKit image from TrueWatch and push it to Cloudflare Container Registry before deployment.

#### 1. Get Your Cloudflare Account ID

You'll need your Cloudflare Account ID for configuring the container image path. To find it:

1. Visit the [Cloudflare documentation on finding account and zone IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)

2. Follow the instructions to copy your Account ID from the Cloudflare dashboard

3. You can also find it in the **Workers & Pages** section of your Cloudflare dashboard under **Account details**

#### 2. Build DataKit Image

Build the DataKit image locally using the Dockerfile. Replace `VERSION` with the latest version you found from the [TrueWatch Platform](#find-datakit-version-and-env_dataway):

1. First, update the `VERSION` in `Dockerfile` (replace `VERSION` with the actual version number, e.g., `1.86.0`)

2. Then build and tag the image:

```bash
docker build --platform=linux/amd64 -t truewatch/datakit:VERSION .
```

**Example** (using version 1.86.0):

1. Update `Dockerfile` to use `1.86.0`:
   ```dockerfile
   FROM pubrepo.truewatch.com/datakit/datakit:1.86.0
   ```

2. Build the image:
   ```bash
   docker build --platform=linux/amd64 -t truewatch/datakit:1.86.0 .
   ```

**Note:** The devcontainer includes Docker-in-Docker support, so you can use Docker commands directly without additional setup.

#### 3. Upload Image to Cloudflare Registry

Upload the image to Cloudflare container registry. Replace `VERSION` with the DataKit version you're using:

```bash
wrangler containers push truewatch/datakit:VERSION
```

**Example** (using version 1.86.0):

```bash
wrangler containers push truewatch/datakit:1.86.0
```

This command will push the image to your Cloudflare account's container registry. The image will be available at `registry.cloudflare.com/YOUR_ACCOUNT_ID/truewatch/datakit:VERSION` where `YOUR_ACCOUNT_ID` is your Cloudflare Account ID and `VERSION` is the DataKit version.

**Note:** Make sure you're authenticated with `wrangler login` before running this command.

#### 4. Verify Image Push

After pushing the image, verify it's available in your Cloudflare Container Registry:

```bash
wrangler containers images list
```

This will list all container images in your registry. You should see your image listed.
```md
REPOSITORY                                 TAG
truewatch/datakit                          1.86.0
```

Alternatively, you can verify by checking the image URL format:
- The image should be available at: `registry.cloudflare.com/YOUR_ACCOUNT_ID/truewatch/datakit:VERSION`
- Replace `YOUR_ACCOUNT_ID` with your Cloudflare Account ID
- Replace `VERSION` with the DataKit version (e.g., `1.86.0`)

#### 5. Update wrangler.jsonc

In your `wrangler.jsonc`, replace `{{CONTAINER_IMAGE}}` with the full image URL from Cloudflare Container Registry:

```jsonc
"containers": [
  {
    "image": "registry.cloudflare.com/YOUR_ACCOUNT_ID/truewatch/datakit:VERSION",
    // ... other container settings
  }
]
```

Replace:
- `YOUR_ACCOUNT_ID` with your Cloudflare Account ID (from step 1)
- `VERSION` with the DataKit version (e.g., `1.86.0`)

**Example:**
```jsonc
"containers": [
  {
    "image": "registry.cloudflare.com/abc123def456/truewatch/datakit:1.86.0",
    // ... other container settings
  }
]
```

### Configure Custom Domain (Optional)

Replace `{{YOUR_CUSTOM_DOMAIN}}` in `wrangler.jsonc` under `routes[0].pattern`:

```jsonc
"routes": [
  {
    "pattern": "{{YOUR_CUSTOM_DOMAIN}}",
    "custom_domain": true
  }
]
```

Ensure the domain is configured in your Cloudflare account before deployment.

### Configure Environment Variables

#### Non-sensitive Variables (in `wrangler.jsonc`)

Set in the `vars` section:

- `ENV_HOSTNAME`: DataKit hostname identifier (will be appended with container instance ID)
- `ENV_GLOBAL_HOST_TAGS`: Global tags applied to all metrics/logs collected by DataKit
- `ENV_HTTP_LISTEN`: HTTP server bind address and port inside the container (format: "0.0.0.0:PORT")
- `ENV_DEFAULT_ENABLED_INPUTS`: Comma-separated list of DataKit input collectors to enable
- `ENV_INPUT_HOSTOBJECT_DISABLE_CLOUD_PROVIDER_SYNC`: Disable cloud provider metadata synchronization
- `ENV_GIN_LOG`: Gin framework log output destination (stdout)
- `ENV_LOG`: DataKit log output destination (stdout)
- `ENV_LOG_LEVEL`: Log level - `"info"` (default) or `"debug"` for verbose logging
- `ENV_INPUT_DK_ENABLE_ALL_METRICS`: Enable all DataKit internal metrics collection
- `ENV_HTTP_PUBLIC_APIS`: Comma-separated list of HTTP endpoints to expose publicly
- `ENV_SLEEP_AFTER`: Container inactivity timeout before shutdown (format: "10m", "1h", etc.)
- `MAX_CONTAINER_INSTANCES`: Maximum number of container instances for load balancing. **IMPORTANT:** The value of `containers[0].max_instances` must be **twice** this value. See [Container Instance Configuration](#container-instance-configuration) for details.

**Note:** Make sure `ENV_HOSTNAME` matches your project name (see [Configure Project Name](#configure-project-name) above)

#### Container Instance Configuration

**IMPORTANT:** The relationship between `MAX_CONTAINER_INSTANCES` and `max_instances` is critical for deployment:

- `MAX_CONTAINER_INSTANCES` (in `vars`) is a string value (e.g., `"2"`)
- `max_instances` (in `containers[0]`) is a **number** (e.g., `4`, not `"4"`)
- `max_instances` must be **exactly twice** the value of `MAX_CONTAINER_INSTANCES`

**Examples:**
- If `MAX_CONTAINER_INSTANCES` is `"2"`, then `max_instances` must be `4`
- If `MAX_CONTAINER_INSTANCES` is `"3"`, then `max_instances` must be `6`

This relationship is required for proper container scaling and deployment.

#### Sensitive Variables (Secrets)

**For Local Development:** Create a `.env` file in the project root:

```env
ENV_DATAWAY=https://your_site-openway.truewatch.com?token=your_token_here
```

Use the complete `ENV_DATAWAY` URL from your [TrueWatch Platform workspace](#find-datakit-version-and-env_dataway). This file is automatically loaded by `wrangler dev`.

**For Production:** Upload secrets using `wrangler secret bulk`:

1. Create `secrets.json` (do not commit):
```json
{
  "ENV_DATAWAY": "https://your_site-openway.truewatch.com?token=your_token_here"
}
```

2. Use the complete `ENV_DATAWAY` URL from your TrueWatch Platform workspace

3. Upload:
```bash
wrangler secret bulk ./secrets.json
```

#### Token Authentication

The Worker enforces token-based authentication for all incoming requests:

- The `token` query parameter in the request URL must match the token in the `ENV_DATAWAY` secret
- If the token is missing or doesn't match, the request will be rejected with a `401 Unauthorized` error
- This ensures that only authorized clients with the correct token can send data to your DataKit instance

**Example Request:**
```bash
curl https://YOUR_CUSTOM_DOMAIN/v1/write/logstreaming?token=your_token_here \
  -H "Content-Type: application/json" \
  -d '{"message": "test log"}'
```

**Note:** The `token` parameter must be included in every request URL. The token value should match the token portion of your `ENV_DATAWAY` URL.

## Local Development

Create a `.env` file with `ENV_DATAWAY` (see [Configure Environment Variables](#configure-environment-variables)). Then start the development server:

```bash
npm run dev
# or
npm start
```

**Note:** Durable Objects and Cloudflare Containers require deployment to function fully. Local dev is useful for testing basic request handling.

## Pre-deployment Checklist

- [ ] DataKit version and `ENV_DATAWAY` obtained from TrueWatch Platform
- [ ] Cloudflare Account ID obtained
- [ ] Template file copied: `cp wrangler.jsonc.template wrangler.jsonc`
- [ ] All placeholders replaced in `wrangler.jsonc`:
  - [ ] `{{PROJECT_NAME}}` replaced in `name`, `vars.ENV_HOSTNAME`, and `containers[0].name`
  - [ ] `{{YOUR_CUSTOM_DOMAIN}}` replaced in `routes[0].pattern` (if using custom domain)
  - [ ] `{{MAX_CONTAINER_INSTANCES}}` replaced in `vars.MAX_CONTAINER_INSTANCES`
  - [ ] `{{MAX_INSTANCES}}` replaced in `containers[0].max_instances` (must be twice `MAX_CONTAINER_INSTANCES`, and is a number not a string - see [Container Instance Configuration](#container-instance-configuration))
  - [ ] `{{CONTAINER_IMAGE}}` replaced with pushed image URL from Cloudflare Container Registry
- [ ] DataKit image downloaded from TrueWatch and pushed to Cloudflare Container Registry
- [ ] Environment variables configured in `wrangler.jsonc` (`ENV_HOSTNAME` matches project name)
- [ ] Secrets uploaded: `.env` for local dev, `wrangler secret bulk` for production
- [ ] Cloudflare authenticated (`wrangler login`)

## Deployment

Before deploying, ensure you have:

1. Downloaded the DataKit image from TrueWatch and pushed it to Cloudflare Container Registry (see [Configure Container Image](#configure-container-image))
2. Replaced all placeholders in `wrangler.jsonc` (see [Initial Setup](#initial-setup))
3. Uploaded secrets for production (see [Configure Environment Variables](#configure-environment-variables))

Then deploy:

```bash
wrangler deploy
```

**Note:** The Docker image must be pushed to Cloudflare Container Registry before deployment. If you need to update the DataKit version, download the new version from TrueWatch, push it to Cloudflare Container Registry, then update the `containers[0].image` value in `wrangler.jsonc` before deploying.

## Verification

Verify your DataKit instance using your custom domain:

### Basic Health Check

```bash
curl -kvL https://YOUR_CUSTOM_DOMAIN/v1/ping
```

Expected response: `pong` or similar success message.

### Test Log Streaming Endpoint

```bash
curl -kvL https://YOUR_CUSTOM_DOMAIN/v1/write/logstreaming?token=your_token_here
```

Replace `your_token_here` with the actual token from your `ENV_DATAWAY` URL. This should return a response indicating the endpoint is available. Without a valid token, you'll receive a `401 Unauthorized` error.

### Check Container Status

You can also check the deployment status in the Cloudflare dashboard:

1. Go to **Workers & Pages** in your Cloudflare dashboard
2. Select your worker (the name from `wrangler.jsonc` → `name`)
3. Check the **Containers** tab to see running container instances
4. View logs in the **Logs** tab to monitor DataKit activity

### Verify Metrics Collection

If DataKit is configured to collect metrics, you can verify by checking the TrueWatch Platform dashboard for incoming data from your DataKit instance.

## Troubleshooting

### Deployment Issues

#### Error: Container image not found

**Problem:** Deployment fails with an error about the container image not being found.

**Solution:**
1. Verify the image was successfully pushed: `wrangler containers images list`
2. Check that the image URL in `wrangler.jsonc` matches exactly (including account ID and version)
3. Ensure you're using the correct Cloudflare Account ID
4. Re-push the image if necessary: `wrangler containers push truewatch/datakit:VERSION`

#### Error: Authentication required

**Problem:** Commands fail with authentication errors.

**Solution:**
1. Run `wrangler login` to authenticate
2. Verify your Cloudflare account has access to Workers, Containers, and Container Registry
3. Check that you're using the correct account (if you have multiple Cloudflare accounts)

### Runtime Issues

#### Container not starting

**Problem:** Container instances are not starting submits data after deployment.

**Solution:**
1. Check Cloudflare dashboard → Workers & Pages → Your Worker → Logs
2. Verify `ENV_DATAWAY` secret is correctly set: `wrangler secret list`
3. Check that the container image URL is correct and accessible
4. Review container logs in the Cloudflare dashboard

#### DataKit not receiving data

**Problem:** DataKit is running but not collecting or sending data.

**Solution:**
1. Verify `ENV_DATAWAY` is correctly configured (check secrets)
2. Check DataKit logs in Cloudflare dashboard
3. Verify the `ENV_DATAWAY` URL is accessible from Cloudflare's network
4. Check TrueWatch Platform dashboard for any connection errors
5. Ensure `ENV_DEFAULT_ENABLED_INPUTS` includes the collectors you need

#### Token authentication errors

**Problem:** Requests are rejected with `401 Unauthorized` error.

**Solution:**
1. Verify the `token` query parameter is included in the request URL
2. Ensure the token matches the token in your `ENV_DATAWAY` secret
3. Check that `ENV_DATAWAY` is correctly set: `wrangler secret list`
4. Example correct request format: `https://YOUR_DOMAIN/v1/write/logstreaming?token=your_token_here`

#### Custom domain not working

**Problem:** Custom domain returns errors or doesn't resolve.

**Solution:**
1. Verify the domain is added to your Cloudflare account
2. Check DNS settings in Cloudflare dashboard
3. Ensure the domain pattern in `wrangler.jsonc` matches your domain exactly
4. Wait a few minutes for DNS propagation if the domain was recently added

### Development Issues

#### Local development not working

**Problem:** `wrangler dev` fails or doesn't start properly.

**Solution:**
1. Ensure `.env` file exists with `ENV_DATAWAY` set
2. Verify `wrangler.jsonc` is valid JSONC (check for syntax errors)
3. Check that all required dependencies are installed: `npm install` or `pnpm install`
4. Review error messages in the terminal for specific issues

#### TypeScript type errors

**Problem:** Type errors after modifying `wrangler.jsonc`.

**Solution:**
1. Regenerate types: `npm run cf-typegen`
2. Verify `wrangler.jsonc` syntax is correct
