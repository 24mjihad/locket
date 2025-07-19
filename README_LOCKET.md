# Locket 🔒

Secure your Obsidian notes by locking files and folders with password protection. When locked content is accessed, it will be blurred and require password authentication to view.

## Features

- 🔒 **Lock individual files or entire folders** - Protect specific notes or whole sections of your vault
- 🌫️ **Content blurring** - Locked content is automatically blurred when viewed
- 🔐 **Password protection** - Each locked item can have its own unique password
- � **Auto-lock on close** - Files automatically lock when closed or when switching to other files
- �📱 **Session-based unlocking** - Once unlocked, content remains accessible until auto-locked or Obsidian is restarted
- ⚙️ **Customizable blur intensity** - Adjust how blurred locked content appears
- 🎯 **Easy management** - Visual manager to see all locked items and manage them

## How to Use

### Locking Files or Folders

1. **Right-click** on any file or folder in the file explorer
2. Select **"🔒 Lock"** from the context menu
3. Set a password for that item
4. Confirm the password

### Unlocking Content

There are several ways to unlock content:

1. **Click the unlock overlay** when viewing a locked file
2. **Right-click** on a locked item and select **"🔓 Unlock"**
3. Use the **Locket Manager** (accessible via the ribbon icon)
4. Use the command palette: **"Locket: Unlock current file"**

### Managing Locked Items

- Click the **🔒 lock icon** in the left ribbon to open the Locket Manager
- View all locked items, unlock them, or remove locks entirely
- Access settings to customize blur intensity and view instructions

## Commands

- `Locket: Lock current file` - Lock the currently active file
- `Locket: Unlock current file` - Unlock the currently active file
- `Locket: Open Locket Manager` - Open the management interface

## Settings

### Blur Intensity
Adjust how blurred locked content appears (1-20). Higher values create more blur.

### Auto-lock on Close
When enabled (default), files are automatically locked when:
- You close a file tab
- You switch to a different file
- You close Obsidian

When disabled, files remain unlocked until you manually lock them or restart Obsidian.

**Note**: Files remain unlocked if they are still open in other tabs.

## Security Notes

- 🔑 **Passwords are hashed** - Your passwords are not stored in plain text
- 💾 **Local storage** - All lock data is stored locally in your Obsidian vault
- 🔄 **Auto-locking** - Files automatically lock when closed (can be disabled in settings)
- 📱 **Session-based** - Unlocked items remain accessible until auto-locked or you restart Obsidian
- 🛡️ **Folder protection** - Locking a folder automatically protects all files within it

## Installation

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to `[vault]/.obsidian/plugins/locket/`
3. Enable the plugin in Obsidian's Community Plugins settings

### Development

```bash
# Clone the repository
git clone https://github.com/your-username/obsidian-locket.git

# Install dependencies
npm install

# Build the plugin
npm run build

# For development with auto-rebuild
npm run dev
```

## How It Works

### File Protection
When you lock a file, Locket:
1. Stores an encrypted hash of your password
2. Monitors when the file is opened
3. Applies a blur effect to the content
4. Shows an unlock overlay requiring password authentication

### Folder Protection
When you lock a folder, Locket:
1. Protects all current files in the folder
2. Automatically protects any new files added to the folder
3. Uses the same password for all files within the folder

### Security Implementation
- Passwords are hashed using a secure hash function
- Lock data is stored in Obsidian's plugin data directory
- Session unlocks are memory-only and cleared on restart

## Troubleshooting

### Content Not Blurring
- Ensure the plugin is enabled
- Try restarting Obsidian
- Check that the file is actually locked in the Locket Manager

### Password Not Working
- Passwords are case-sensitive
- Try removing and re-adding the lock
- Check for any special characters that might not be displayed correctly

### Performance Issues
- Lower the blur intensity in settings
- Consider locking fewer items if you experience slowdowns

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have feature requests, please [open an issue](https://github.com/your-username/obsidian-locket/issues) on GitHub.

---

**⚠️ Important Security Note**: This plugin provides a layer of content obfuscation and access control within Obsidian. It is not intended as a replacement for proper file system encryption or vault-level security measures for highly sensitive information.
