# qq bot

This project is for create the qq bot to manage the qq group service.

## architecture

we use to use the bot to manage _group_, but the office bot need the company register, not open to personal. So here we use the [NapCatQQ](https://napneko.github.io/) to open the `websocket` ability by hook the node function. then use the [NcatBot](https://docs.ncatbot.xyz/) to call the all function by the `websocket`.

> we need first to open the NapCatQQ
> `xvfb-run -a qq --no-sandbox` start the qq bot in the background
> `screen -dmS napcat bash -c "xvfb-run -a qq --no-sandbox"`

## Development

### Prerequisites

1. Install Python 3.7+ and pip
2. Install required packages: `pip install -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple`
3. Set up [NapCatQQ](https://napneko.github.io/) and make sure it's running

> NOTE: `pip install ncatbot -U -i https://mirrors.aliyun.com/pypi/simple` the `ncatbot` only publish on the `aliyun` mirror, so you need to use the `-i` to install it.

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
BOT_UIN=your_bot_qq_number
WS_URI=ws://localhost:3001
BOT_TOKEN=your_napcat_token
AD_FILTERED_GROUPS=996893666,996893623
```

### Running the Bot

Basic run:

```bash
python main.py
```

### Hot Reloading

For development with hot reloading, install `watchdog`:

```bash
pip install watchdog
```

Run the bot with hot reloading:

```bash
python run_dev.py
```

This will automatically restart the bot whenever you make changes to the code.

### Running in Background

For production deployment, you'll want to run the bot in the background. Here are several methods:

#### Using nohup

```bash
nohup python main.py > bot.log 2>&1 &
```

This will run the bot in the background, redirect output to bot.log, and continue running even after you log out.

To check the process:

```bash
ps aux | grep python
```

To stop the bot:

```bash
pkill -f "python main.py"
```

#### Using screen

1. Install screen (if not already installed):

```bash
# Debian/Ubuntu
sudo apt-get install screen

# CentOS/RHEL
sudo yum install screen
```

2.Start a new screen session:

```bash
screen -S qq-bot
```

3.Run the bot:

```bash
python main.py
```

4.Detach from the screen session by pressing `Ctrl+A` followed by `D`.

To reattach to the session:

```bash
screen -r qq-bot
```

#### Using systemd (Linux)

1.Create a systemd service file:

```bash
sudo nano /etc/systemd/system/qq-bot.service
```

2.Add the following content:

```plaintext
[Unit]
Description=QQ Bot Service
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/Users/xiangjiahao/py/qq-bot
ExecStart=/usr/bin/python3 /Users/xiangjiahao/py/qq-bot/main.py
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

3.Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable qq-bot
sudo systemctl start qq-bot
```

4.Check the service status:

```bash
sudo systemctl status qq-bot
```

5.View logs:

```bash
sudo journalctl -u qq-bot -f
```
