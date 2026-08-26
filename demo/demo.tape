# Records the README demo. Regenerate with:  vhs demo/demo.tape
Output demo/umami-mcp-demo.gif
Output demo/umami-mcp-demo.mp4

Set Shell bash
Set FontSize 15
Set Width 1080
Set Height 720
Set Padding 26
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

# Set up off-camera: use the read-only service account, not a personal login.
Hide
Type "cd ~/umami-mcp && export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
Enter
Type "export UMAMI_MCP_ENV_FILE=$HOME/.config/umami-mcp/bot.env UMAMI_MCP_MODE=read"
Enter
Type "clear"
Enter
Sleep 500ms
Show

Type "node demo/demo.mjs aiscan.site"
Sleep 600ms
Enter
Sleep 15s
