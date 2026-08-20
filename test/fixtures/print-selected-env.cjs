process.stdout.write('SSH_LOCAL_ENV_PROBE=' + JSON.stringify({
	BASE_URL: process.env.BASE_URL,
	USER_RUNTIME_SECRET: process.env.USER_RUNTIME_SECRET,
	JOB_SECRET: process.env.JOB_SECRET,
	JOB_GLOBALENV: process.env.JOB_GLOBALENV,
	SSH_HOST: process.env.SSH_HOST,
	SSH_PASSWORD: process.env.SSH_PASSWORD,
	SSH_KEY: process.env.SSH_KEY,
	SSH_PASSPHRASE: process.env.SSH_PASSPHRASE
}) + '\n');
