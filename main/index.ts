import { serve } from 'https://deno.land/std@0.131.0/http/server.ts';
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts';

declare const EdgeRuntime: {
	userWorkers: {
		create(options: {
			servicePath: string;
			memoryLimitMb: number;
			workerTimeoutMs: number;
			noModuleCache: boolean;
			importMapPath: string | null | undefined;
			envVars: Array<[string, string]>;
			cpuTimeSoftLimitMs: number;
			cpuTimeHardLimitMs: number;
		}): Promise<{ fetch(request: Request): Promise<Response> }>;
	};
};

console.log('main function started');

const JWT_SECRET = Deno.env.get('JWT_SECRET');
const IS_VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true';

function getAuthToken(request: Request) {
	const authHeader = request.headers.get('authorization');
	if (authHeader === null || authHeader === '') {
		throw new Error('Missing authorization header');
	}

	const [bearer, token] = authHeader.split(' ');
	if (bearer !== 'Bearer') {
		throw new Error("Auth header is not 'Bearer {token}'");
	}

	return token;
}

async function verifyJWT(jwt: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const secretKey = encoder.encode(JWT_SECRET);
	try {
		await jose.jwtVerify(jwt, secretKey);
	} catch (error) {
		console.error(error);
		return false;
	}

	return true;
}

serve(async (request: Request) => {
	if (request.method !== 'OPTIONS' && IS_VERIFY_JWT) {
		try {
			const token = getAuthToken(request);
			const isValidJWT = await verifyJWT(token);

			if (!isValidJWT) {
				return Response.json(
					{ msg: 'Invalid JWT' },
					{
						status: 401,
						headers: { 'Content-Type': 'application/json' },
					}
				);
			}
		} catch (error) {
			console.error(error);
			return Response.json(
				{ msg: (error as Error).toString() },
				{
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}
			);
		}
	}

	const url = new URL(request.url);
	const { pathname } = url;
	const path_parts = pathname.split('/');
	const service_name = path_parts[1];

	if (service_name === '') {
		const error = { msg: 'missing function name in request' };
		return Response.json(error, {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const servicePath = `/home/deno/functions/${service_name}`;
	console.error(`serving the request with ${servicePath}`);

	const memoryLimitMb = 150;
	const workerTimeoutMs = 1 * 60 * 1000;
	const isNoModuleCache = false;
	const importMapPath = null;
	const envVarsObject = Deno.env.toObject();
	const envVars = Object.entries(envVarsObject).map(
		([k, value]) => [k, value] as [string, string]
	);

	const cpuTimeSoftLimitMs = 15_000;
	const cpuTimeHardLimitMs = 20_000;

	try {
		const worker = await EdgeRuntime.userWorkers.create({
			servicePath,
			memoryLimitMb,
			workerTimeoutMs,
			noModuleCache: isNoModuleCache,
			importMapPath,
			envVars,
			cpuTimeSoftLimitMs,
			cpuTimeHardLimitMs,
		});
		return await worker.fetch(request);
	} catch (error_) {
		const error = { msg: (error_ as Error).toString() };
		return Response.json(error, {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
});
