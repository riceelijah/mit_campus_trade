/**
 * Deploys the built frontend to S3 and invalidates CloudFront so it's actually served.
 *
 * Uploading to S3 alone isn't enough -- CloudFront keeps serving whatever it already cached
 * until told otherwise, so this always follows the sync with an invalidation. Always builds
 * fresh via `npm run build` first -- never assumes an existing dist/ is current.
 *
 * The S3 sync uses `--delete`, which removes anything in the bucket that isn't part of the
 * fresh build (old hashed JS/CSS chunks from previous builds) -- intentional, not a
 * copy-paste risk: without it the bucket would grow forever. There's a small, accepted race
 * window where a client mid-page-load could request a chunk that's just been deleted before
 * the invalidation below finishes propagating; not worth engineering around at this scale.
 *
 * This deploys straight to production -- there is no staging environment and no confirmation
 * prompt. Run via `npx tsx scripts/deploy-frontend.ts` (or `npm run deploy:frontend`).
 * Requires the AWS CLI installed and configured with credentials that can write to the bucket
 * and create CloudFront invalidations.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || 'mitcampustrade.ccc-mit.org';
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || 'E2FAAV4FWGKI2K';

function run(command: string, args: string[]) {
    console.log(`$ ${command} ${args.join(' ')}`);
    try {
        execFileSync(command, args, { stdio: 'inherit', cwd: repoRoot });
    } catch (err) {
        if (command === 'aws' && err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw Object.assign(new Error('Could not run `aws` -- is the AWS CLI installed and on PATH?'), {
                cause: err,
            });
        }
        throw err;
    }
}

console.log(
    `Deploying frontend to s3://${S3_BUCKET_NAME}, invalidating CloudFront ${CLOUDFRONT_DISTRIBUTION_ID}...`,
);
run('npm', ['run', 'build']);
run('aws', ['s3', 'sync', 'dist/', `s3://${S3_BUCKET_NAME}`, '--delete']);
run('aws', [
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    CLOUDFRONT_DISTRIBUTION_ID,
    '--paths',
    '/*',
]);
console.log('Frontend deployed. CloudFront invalidation may take a few minutes to propagate.');
