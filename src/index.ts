import { Container } from '@cloudflare/containers';

/**
 * Get a random container instance, avoiding instances with 'stopping' status
 * Supports version control via version prefix in instance names for blue-green deployments
 * @param binding - DurableObjectNamespace for the container
 * @param instances - Number of container instances (default: 3)
 * @param version - Optional version prefix for instance names (e.g., from CF_VERSION_METADATA.id)
 * @returns DurableObjectStub for a container instance that is not stopping
 */
export async function getRandom<T extends Container>(
  binding: DurableObjectNamespace<T>,
  instances: number = 3,
  version: string = ''
): Promise<DurableObjectStub<T>> {
  // Validate instances parameter
  if (!instances || instances <= 0) {
    throw new Error(`Invalid instances parameter: ${instances}. Must be a positive integer.`);
  }
  
  // Helper function to generate instance name with optional version prefix
  const getInstanceName = (id: number): string => {
    return version ? `${version}-instance-${id}` : `instance-${id}`;
  };

  // Case 1: Only one instance - check status but still return it if stopping
  if (instances === 1) {
    const objectId = binding.idFromName(getInstanceName(0));
    const stub = binding.get(objectId);
    
    try {
      // @ts-ignore - getState is available via RPC on Container
      const state = await stub.getState();
      if (state.status === 'stopping') {
        console.warn(`[getRandom] Only one instance available and it is stopping (${getInstanceName(0)}), returning it anyway`);
      }
    } catch (err) {
      // If getState fails, log warning but return the stub anyway
      console.warn(`[getRandom] Failed to get state for ${getInstanceName(0)}, using it anyway: ${err}`);
    }
    
    return stub;
  }

  // Case 2: Two instances - direct flip logic
  if (instances === 2) {
    // Start with a random instance (0 or 1)
    const firstId = Math.floor(Math.random() * 2);
    const firstObjectId = binding.idFromName(getInstanceName(firstId));
    const firstStub = binding.get(firstObjectId);
    
    try {
      // @ts-ignore - getState is available via RPC on Container
      const firstState = await firstStub.getState();
      if (firstState.status !== 'stopping') {
        return firstStub;
      }
    } catch (err) {
      // If getState fails, return the first stub anyway
      console.warn(`[getRandom] Failed to get state for ${getInstanceName(firstId)}, using it anyway: ${err}`);
      return firstStub;
    }
    
    // First instance is stopping, try the other one
    const secondId = 1 - firstId; // Flip: if firstId is 0, secondId is 1; if firstId is 1, secondId is 0
    const secondObjectId = binding.idFromName(getInstanceName(secondId));
    const secondStub = binding.get(secondObjectId);
    
    try {
      // @ts-ignore - getState is available via RPC on Container
      const secondState = await secondStub.getState();
      if (secondState.status !== 'stopping') {
        return secondStub;
      }
    } catch (err) {
      // If getState fails, return the second stub anyway
      console.warn(`[getRandom] Failed to get state for ${getInstanceName(secondId)}, using it anyway: ${err}`);
      return secondStub;
    }
    
    // Both instances are stopping, return the last one (second one)
    return secondStub;
  }

  // Case 3: More than two instances - check all in parallel, then random select
  const instanceIds = Array.from({ length: instances }, (_, i) => i);
  const instanceStubs = instanceIds.map(id => {
    const objectId = binding.idFromName(getInstanceName(id));
    return { id, stub: binding.get(objectId) };
  });

  // Check all instances in parallel
  const stateChecks = await Promise.allSettled(
    instanceStubs.map(async ({ id, stub }) => {
      try {
        // @ts-ignore - getState is available via RPC on Container
        const state = await stub.getState();
        return { id, stub, status: state.status, available: state.status !== 'stopping' };
      } catch (err) {
        // If getState fails, consider it available (fallback behavior)
        console.warn(`[getRandom] Failed to get state for ${getInstanceName(id)}, considering available: ${err}`);
        return { id, stub, status: 'unknown', available: true };
      }
    })
  );

  // Filter available instances
  const availableInstances = stateChecks
    .filter((result): result is PromiseFulfilledResult<{ id: number; stub: DurableObjectStub<T>; status: string; available: boolean }> => 
      result.status === 'fulfilled' && result.value.available
    )
    .map(result => result.value);

  if (availableInstances.length > 0) {
    // Randomly select from available instances
    const randomIndex = Math.floor(Math.random() * availableInstances.length);
    return availableInstances[randomIndex].stub;
  }

  // All instances are stopping, return the last one
  return instanceStubs[instanceStubs.length - 1].stub;
}

/**
 * DataKit Durable Object that manages a DataKit container instance
 * Extends Container base class to handle container lifecycle and request proxying
 */
export class DataKit extends Container {
  defaultPort = 9529;
  requiredPorts = [9529];
  sleepAfter = '10m';

  constructor(ctx: any, env: Env) {
    super(ctx, env);
    
    // Parse port from ENV_HTTP_LISTEN (format: "0.0.0.0:9529")
    const url = new URL(`http://${env.ENV_HTTP_LISTEN || '0.0.0.0:9529'}`);
    const parsedPort = parseInt(url.port, 10);
    const port = (!isNaN(parsedPort) && parsedPort > 0) ? parsedPort : this.defaultPort;
    this.defaultPort = port;
    this.requiredPorts = [port];

    // Configure container sleep timeout
    const sleepAfter = env.ENV_SLEEP_AFTER || this.sleepAfter;
    this.sleepAfter = sleepAfter;

    // Build container environment variables from wrangler.jsonc vars
    const containerEnv: Record<string, string> = {};
    
    // Validate and set required secret ENV_DATAWAY (DataKit dataway endpoint URL)
    if (!(env as any).ENV_DATAWAY) {
      throw new Error('ENV_DATAWAY is required but not set. Please set it using: wrangler secret put ENV_DATAWAY');
    }
    containerEnv.ENV_DATAWAY = (env as any).ENV_DATAWAY;
    
    // Copy environment variables from wrangler.jsonc vars to container environment
    // List of environment variable keys to copy (only if they exist in env)
    const envVarKeys = [
      'ENV_HOSTNAME',
      'ENV_GLOBAL_HOST_TAGS',
      'ENV_HTTP_LISTEN',
      'ENV_DEFAULT_ENABLED_INPUTS',
      'ENV_INPUT_HOSTOBJECT_DISABLE_CLOUD_PROVIDER_SYNC',
      'ENV_GIN_LOG',
      'ENV_LOG',
      'ENV_LOG_LEVEL',
      'ENV_INPUT_DK_ENABLE_ALL_METRICS',
      'ENV_HTTP_PUBLIC_APIS',
      'ENV_SLEEP_AFTER',
    ] as const;
    
    for (const key of envVarKeys) {
      const value = env[key];
      if (value && typeof value === 'string') {
        containerEnv[key] = value;
      }
    }
    
    // Add container instance ID to environment variables for container identification
    const instanceId = ctx.id?.toString() || 'unknown';
    containerEnv.ENV_CONTAINER_ID = instanceId;
    // Append instance ID to hostname for unique identification
    if (containerEnv.ENV_HOSTNAME && containerEnv.ENV_CONTAINER_ID !== 'unknown') {
      containerEnv.ENV_HOSTNAME = `${containerEnv.ENV_HOSTNAME}_${instanceId}`;
    }
    
    // Set container environment variables and enable internet access
    // @ts-ignore - envVars and enableInternet are protected properties from Container base class
    this.envVars = containerEnv;
    // @ts-ignore - enableInternet is a protected property from Container base class
    this.enableInternet = true;
  }

  /**
   * Decompress request body if it's gzip or deflate encoded
   * @param req - Original request with potentially compressed body
   * @returns Request with decompressed body, or original request if not compressed
   */
  private async decompressRequest(req: Request): Promise<Request> {
    const contentEncoding = req.headers.get('content-encoding');
    if (!contentEncoding || !req.body) return req;

    // Detect compression format
    const format = contentEncoding.toLowerCase().includes('gzip') ? 'gzip' 
                : contentEncoding.toLowerCase().includes('deflate') ? 'deflate'
                : null;
    
    if (!format) return req;

    // Clone request to avoid consuming the original body stream
    // This ensures the original request body remains available if needed elsewhere
    const clonedReq = req.clone();
    
    // Decompress the body from the cloned request
    if (!clonedReq.body) {
      return req; // Should not happen, but defensive check
    }
    const decompressionStream = new DecompressionStream(format);
    const decompressedBody = clonedReq.body.pipeThrough(decompressionStream);
    const decompressedArrayBuffer = await new Response(decompressedBody).arrayBuffer();
    
    // Update headers to reflect decompressed content
    const headers = new Headers(req.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.set('content-length', decompressedArrayBuffer.byteLength.toString());
    
    return new Request(req, {
      headers: headers,
      body: decompressedArrayBuffer,
    });
  }

  /**
   * Parse log body text into array of log objects
   * Supports both NDJSON (newline-delimited JSON) and single JSON object formats
   * @param bodyText - Raw body text to parse
   * @returns Array of parsed log objects
   */
  private parseLogBody(bodyText: string): any[] {
    const lines = bodyText.trim().split('\n').filter(line => line.trim());
    const logs: any[] = [];
    
    // Try parsing as NDJSON format (each line is a JSON object)
    for (const line of lines) {
      try {
        logs.push(JSON.parse(line));
      } catch {
        // If any line fails to parse, NDJSON format is invalid
        logs.length = 0;
        break;
      }
    }
    
    // If NDJSON parsing failed, try parsing as a single JSON object
    if (logs.length === 0) {
      try {
        logs.push(JSON.parse(bodyText));
      } catch (parseError) {
        // Both NDJSON and single JSON parsing failed
        const preview = bodyText.substring(0, 100).replace(/\n/g, '\\n');
        const errorMessage = parseError instanceof Error 
          ? parseError.message 
          : 'Unknown JSON parse error';
        throw new Error(
          `Invalid log format: body is neither valid NDJSON nor valid JSON object. ` +
          `Parse error: ${errorMessage}. Body preview: ${preview}${bodyText.length > 100 ? '...' : ''}`
        );
      }
    }
    
    return logs;
  }

  /**
   * Convert logstreaming request body to JSON array format
   * Handles three input formats: JSON array, single JSON object, and NDJSON
   * @param req - Original request with log data
   * @returns Request with body converted to JSON array format
   */
  private async convertLogstreamingToArray(req: Request): Promise<Request> {
    const bodyText = await req.text();
    if (!bodyText.trim()) {
      // Return empty array for empty body
      const emptyArrayBody = JSON.stringify([]);
      const headers = new Headers(req.headers);
      headers.set('content-length', new Blob([emptyArrayBody]).size.toString());
      headers.set('content-type', 'application/json');
      return new Request(req, { headers, body: emptyArrayBody });
    }

    // Try parsing as JSON first
    try {
      const parsed = JSON.parse(bodyText);
      if (Array.isArray(parsed)) {
        // Already a JSON array, no conversion needed
        const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
        console.log(`[Container ID: ${instanceId}] Body is already a JSON array with ${parsed.length} ${parsed.length === 1 ? 'entry' : 'entries'}, no conversion needed`);
        // Update headers to ensure content-length is correct
        const headers = new Headers(req.headers);
        headers.set('content-length', new Blob([bodyText]).size.toString());
        headers.set('content-type', 'application/json');
        return new Request(req, { headers, body: bodyText });
      }
      // Single JSON object: wrap it in an array
      const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
      console.log(`[Container ID: ${instanceId}] Single JSON object detected, wrapping in array`);
      const arrayBody = JSON.stringify([parsed]);
      const headers = new Headers(req.headers);
      headers.set('content-length', new Blob([arrayBody]).size.toString());
      headers.set('content-type', 'application/json');
      return new Request(req, { headers, body: arrayBody });
    } catch {
      // Not valid JSON, try parsing as NDJSON (newline-delimited JSON)
      const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
      console.log(`[Container ID: ${instanceId}] Not valid JSON, trying NDJSON format`);
    }

    // Parse as NDJSON format and convert to JSON array
    const logs = this.parseLogBody(bodyText);
    const arrayBody = JSON.stringify(logs);
    
    const headers = new Headers(req.headers);
    headers.set('content-length', new Blob([arrayBody]).size.toString());
    headers.set('content-type', 'application/json');
    
    const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
    console.log(`[Container ID: ${instanceId}] Converted ${logs.length} NDJSON log ${logs.length === 1 ? 'entry' : 'entries'} to JSON array`);
    
    return new Request(req, {
      headers: headers,
      body: arrayBody,
    });
  }

  /**
   * Handle incoming HTTP requests
   * Processes requests by decompressing, converting logstreaming format, and proxying to container
   * @param req - Incoming HTTP request
   * @returns Response from container or error response
   */
  async fetch(req: Request) {
    try {
      const url = new URL(req.url);
      const instanceId = (this as any).ctx?.id?.toString() || 'unknown';

      // Decompress request body if gzip/deflate encoded
      let processedReq = await this.decompressRequest(req);

      // Check container state and ensure it's running before processing requests
      // Container states: stopped -> running -> healthy
      // @ts-ignore - getState is available on Container base class
      const state = await this.getState();
      if (state.status !== 'running' && state.status !== 'healthy') {
        console.log(`[Container ID: ${instanceId}] Container is not running (status: ${state.status}), waiting for it to start...`);
        // @ts-ignore - startAndWaitForPorts is available on Container base class
        await this.startAndWaitForPorts({
          cancellationOptions: {
            portReadyTimeoutMS: 90000, // Maximum time to wait for ports to be ready (90 seconds)
            waitInterval: 200, // Polling interval for checking container/port status (200ms)
            instanceGetTimeoutMS: 30000, // Maximum time to wait for container to start (30 seconds)
          }
        });
      }

      // Convert logstreaming endpoint requests to JSON array format
      // Supports JSON array, single JSON object, and NDJSON input formats
      if (url.pathname.includes('/logstreaming') && processedReq.body) {
        try {
          const clonedReqForConversion = processedReq.clone();
          const convertedReq = await this.convertLogstreamingToArray(clonedReqForConversion);
          processedReq = convertedReq;
        } catch (err) {
          // If conversion fails, return error response
          // Conversion is required for logstreaming endpoint
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[Container ID: ${instanceId}] Failed to convert logstreaming format: ${errorMessage}`);
          
          return new Response(JSON.stringify({
            error: 'Invalid log format: unable to parse request body',
            details: errorMessage,
            timestamp: new Date().toISOString(),
            instanceId: instanceId
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Forward request to container using base class fetch method
      // Base class handles container startup, port readiness, and request proxying
      const response = await super.fetch(processedReq);
      
      return response;
    } catch (err) {
      // Handle errors and return JSON error response
      const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[Container ID: ${instanceId}] Error: ${errorMessage}`);
      
      return new Response(JSON.stringify({
        error: errorMessage,
        timestamp: new Date().toISOString(),
        instanceId: instanceId
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle alarm events from Cloudflare Durable Objects
   * Called when an alarm is triggered for this Durable Object instance
   * @param alarmInfo - Alarm invocation information (isRetry, retryCount)
   */
  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    const instanceId = (this as any).ctx?.id?.toString() || 'unknown';
    const scheduledTime = new Date().toISOString();
    const isRetry = alarmInfo?.isRetry || false;
    const retryCount = alarmInfo?.retryCount || 0;
    
    console.log(`[Container ID: ${instanceId}] Alarm triggered at ${scheduledTime} (isRetry: ${isRetry}, retryCount: ${retryCount})`);
  }
}

/**
 * Main Worker entry point
 * Routes requests to DataKit Durable Object instances using load balancing
 */
export default {
  /**
   * Handle incoming HTTP requests and route to DataKit container instances
   * @param request - Incoming HTTP request
   * @param env - Worker environment variables and bindings
   * @returns Response from container instance or error response
   */
  async fetch(request, env): Promise<Response> {
    // Parse maximum container instances from environment variable
    let maxInstances: number | null = null;
    
    // Check if MAX_CONTAINER_INSTANCES is set
    if (env.MAX_CONTAINER_INSTANCES !== undefined && env.MAX_CONTAINER_INSTANCES !== null) {
      const parsed = parseInt(env.MAX_CONTAINER_INSTANCES, 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxInstances = parsed;
      }
    }
    
    // Validate MAX_CONTAINER_INSTANCES configuration
    if (maxInstances === null || maxInstances <= 0) {
      const requestId = request.headers.get('cf-ray') || request.headers.get('x-request-id') || 'unknown';
      const errorMsg = env.MAX_CONTAINER_INSTANCES === undefined || env.MAX_CONTAINER_INSTANCES === null
        ? 'MAX_CONTAINER_INSTANCES is required but not set in wrangler.jsonc vars'
        : `MAX_CONTAINER_INSTANCES has invalid value: "${env.MAX_CONTAINER_INSTANCES}". Must be a positive integer.`;
      console.error(`[Main Handler] Configuration error (requestId: ${requestId}): ${errorMsg}`);
      
      return new Response(JSON.stringify({
        error: errorMsg,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      // Get version ID from CF_VERSION_METADATA for blue-green deployment support
      // In local development (wrangler dev), CF_VERSION_METADATA may not exist, so use 'dev-local' as fallback
      // Each deployment gets a unique version ID, automatically routing to new container instances
      const version = env.CF_VERSION_METADATA?.id || 'dev-local';
      
      // Use getRandom helper to load balance requests across container instances
      // Randomly selects one of maxInstances Durable Object instances, avoiding 'stopping' status
      // Version prefix ensures each deployment routes to its own set of container instances
      const containerInstance = await getRandom(env.CONTAINER, maxInstances, version);
      
      // Clone request before forwarding to avoid "ReadableStream is disturbed" error
      // (request body can only be read once)
      const clonedRequest = request.clone();
      const response = await containerInstance.fetch(clonedRequest);
      
      return response;
    } catch (err) {
      // Handle errors and return JSON error response
      const requestId = request.headers.get('cf-ray') || request.headers.get('x-request-id') || 'unknown';
      const errorMessage = err instanceof Error ? err.message : String(err);
      
      console.error(`[Main Handler] Caught exception (requestId: ${requestId}): ${errorMessage}`);
      
      return new Response(JSON.stringify({
        error: errorMessage,
        timestamp: new Date().toISOString(),
        requestId: requestId
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
} satisfies ExportedHandler<Env>;
