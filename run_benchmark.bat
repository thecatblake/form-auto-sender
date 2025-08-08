REM Set environment variables
set REDIS_USERNAME=default
set REDIS_HOST=localhost
set REDIS_PORT=6379
set OPENAI_API_KEY=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

REM Run the Python benchmark script
call conda activate test
python benchmark.py

REM Optional: Pause to see the output before the window closes
pause
