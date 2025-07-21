import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, Menu, TAbstractFile } from 'obsidian';

interface LocketSettings {
	masterPassword: string;
	lockedItems: { [path: string]: { type: 'file' | 'folder'; hashedPassword: string } };
	blurIntensity: number;
	autoLockOnClose: boolean;
}

const DEFAULT_SETTINGS: LocketSettings = {
	masterPassword: '',
	lockedItems: {},
	blurIntensity: 10,
	autoLockOnClose: true
}

export default class LocketPlugin extends Plugin {
	settings: LocketSettings;
	private unlockedSessions: Set<string> = new Set();
	private blurredElements: Map<string, HTMLElement[]> = new Map();
	private lastActiveFile: TFile | null = null;
	private openFiles: Set<string> = new Set();

	async onload() {
		await this.loadSettings();

		// Add ribbon icon
		this.addRibbonIcon('lock', 'Lock/Unlock Files', (evt: MouseEvent) => {
			new LocketManagerModal(this.app, this).open();
		});

		// Add commands
		this.addCommand({
			id: 'lock-current-file',
			name: 'Lock current file',
			callback: () => {
				this.lockCurrentFile();
			}
		});

		this.addCommand({
			id: 'unlock-current-file',
			name: 'Unlock current file',
			callback: () => {
				this.unlockCurrentFile();
			}
		});

		this.addCommand({
			id: 'open-manager',
			name: 'Open manager',
			callback: () => {
				new LocketManagerModal(this.app, this).open();
			}
		});

		// Register file menu events
		this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
			if (file instanceof TFile || file instanceof TFolder) {
				const isLocked = this.isItemLocked(file.path);
				
				if (isLocked) {
					menu.addItem((item) => {
						item.setTitle('🔓 Unlock')
							.setIcon('unlock')
							.onClick(() => {
								this.promptUnlock(file.path);
							});
					});
				} else {
					menu.addItem((item) => {
						item.setTitle('🔒 Lock')
							.setIcon('lock')
							.onClick(() => {
								this.promptLock(file);
							});
					});
				}
			}
		}));

		// Hook into file opening
		this.registerEvent(this.app.workspace.on('file-open', (file: TFile) => {
			if (file && this.shouldBlurFile(file)) {
				this.blurFileContent(file);
			}
		}));

		// Hook into active leaf change
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
			// Auto-lock previous file when switching away (if auto-lock is enabled)
			if (this.settings.autoLockOnClose && leaf && leaf.view && leaf.view.getViewType() === 'markdown') {
				const previousFile = this.lastActiveFile;
				if (previousFile && this.isItemLocked(previousFile.path)) {
					// Only lock if the previous file is not still open in another tab
					const stillOpen = Array.from(this.app.workspace.getLeavesOfType('markdown')).some(otherLeaf => {
						return otherLeaf !== leaf && (otherLeaf.view as MarkdownView).file?.path === previousFile.path;
					});
					if (!stillOpen) {
						this.lockFileSession(previousFile.path);
					}
				}
			}
			this.checkAndBlurActiveFile();
		}));

		// Track the currently active file and update open files
		this.registerEvent(this.app.workspace.on('file-open', (file: TFile) => {
			this.lastActiveFile = file;
			if (file) {
				this.openFiles.add(file.path);
			}
		}));

		// Initialize tracking of currently open files
		this.updateOpenFiles();

		// Settings tab
		this.addSettingTab(new LocketSettingTab(this.app, this));

		// Clean up sessions when Obsidian closes
		this.registerEvent(this.app.workspace.on('quit', () => {
			this.unlockedSessions.clear();
		}));

		// Also listen for when tabs are closed directly
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			// Delay the check slightly to ensure layout has updated
			setTimeout(() => {
				this.checkClosedFiles();
			}, 100);
		}));
	}

	onunload() {
		this.clearAllBlurs();
		this.unlockedSessions.clear();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private hashPassword(password: string): string {
		// Simple hash function for browser compatibility
		let hash = 0;
		if (password.length === 0) return hash.toString();
		for (let i = 0; i < password.length; i++) {
			const char = password.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(36);
	}

	private isItemLocked(path: string): boolean {
		if (this.settings.lockedItems[path]) {
			return true;
		}
		
		// Check if any parent folder is locked
		const pathParts = path.split('/');
		for (let i = pathParts.length - 1; i > 0; i--) {
			const parentPath = pathParts.slice(0, i).join('/');
			if (this.settings.lockedItems[parentPath]?.type === 'folder') {
				return true;
			}
		}
		return false;
	}

	private isSessionUnlocked(path: string): boolean {
		if (this.unlockedSessions.has(path)) {
			return true;
		}
		
		// Check if any parent folder session is unlocked
		const pathParts = path.split('/');
		for (let i = pathParts.length - 1; i > 0; i--) {
			const parentPath = pathParts.slice(0, i).join('/');
			if (this.unlockedSessions.has(parentPath)) {
				return true;
			}
		}
		return false;
	}

	private shouldBlurFile(file: TFile): boolean {
		return this.isItemLocked(file.path) && !this.isSessionUnlocked(file.path);
	}

	private async blurFileContent(file: TFile) {
		setTimeout(() => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file === file) {
				const contentEl = activeView.contentEl;
				const editorEl = contentEl.querySelector('.cm-editor');
				
				if (editorEl) {
					this.applyBlur(editorEl as HTMLElement, file.path);
					this.showUnlockOverlay(contentEl, file.path);
				}
			}
		}, 100);
	}

	private applyBlur(element: HTMLElement, path: string) {
		element.addClass('locket-blurred');
		
		if (!this.blurredElements.has(path)) {
			this.blurredElements.set(path, []);
		}
		this.blurredElements.get(path)?.push(element);
	}

	private showUnlockOverlay(contentEl: HTMLElement, path: string) {
		const overlay = contentEl.createDiv('locket-overlay');
		
		const unlockButton = overlay.createDiv('locket-unlock-button');
		unlockButton.setText('🔒 Click to unlock this content');
		
		unlockButton.addEventListener('click', () => {
			this.promptUnlock(path);
		});

		if (!this.blurredElements.has(path)) {
			this.blurredElements.set(path, []);
		}
		this.blurredElements.get(path)?.push(overlay);
	}

	private clearBlur(path: string) {
		const elements = this.blurredElements.get(path);
		if (elements) {
			elements.forEach(el => {
				if (el.classList.contains('locket-overlay')) {
					el.remove();
				} else {
					el.removeClass('locket-blurred');
				}
			});
			this.blurredElements.delete(path);
		}
	}

	private clearAllBlurs() {
		this.blurredElements.forEach((elements, path) => {
			this.clearBlur(path);
		});
	}

	private checkAndBlurActiveFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && this.shouldBlurFile(activeFile)) {
			this.blurFileContent(activeFile);
		}
	}

	async promptLock(file: TAbstractFile) {
		new PasswordSetModal(this.app, this, file).open();
	}

	async promptUnlock(path: string) {
		new PasswordUnlockModal(this.app, this, path).open();
	}

	async lockItem(file: TAbstractFile, password: string) {
		const hashedPassword = this.hashPassword(password);
		this.settings.lockedItems[file.path] = {
			type: file instanceof TFile ? 'file' : 'folder',
			hashedPassword
		};
		await this.saveSettings();
		new Notice(`🔒 ${file instanceof TFile ? 'File' : 'Folder'} "${file.name}" has been locked`);
		
		// If it's the current file, blur it immediately
		if (file instanceof TFile && this.app.workspace.getActiveFile() === file) {
			this.blurFileContent(file);
		}
	}

	async unlockItem(path: string, password: string): Promise<boolean> {
		const lockedItem = this.getLockedItemForPath(path);
		if (!lockedItem) return false;

		const hashedPassword = this.hashPassword(password);
		if (hashedPassword === lockedItem.hashedPassword) {
			this.unlockedSessions.add(this.getUnlockKeyForPath(path));
			this.clearBlur(path);
			new Notice('🔓 Content unlocked for this session');
			return true;
		}
		return false;
	}

	private getLockedItemForPath(path: string) {
		// First check if the path itself is locked
		if (this.settings.lockedItems[path]) {
			return this.settings.lockedItems[path];
		}
		
		// Check if any parent folder is locked
		const pathParts = path.split('/');
		for (let i = pathParts.length - 1; i > 0; i--) {
			const parentPath = pathParts.slice(0, i).join('/');
			if (this.settings.lockedItems[parentPath]?.type === 'folder') {
				return this.settings.lockedItems[parentPath];
			}
		}
		return null;
	}

	private getUnlockKeyForPath(path: string): string {
		// First check if the path itself is locked
		if (this.settings.lockedItems[path]) {
			return path;
		}
		
		// Check if any parent folder is locked
		const pathParts = path.split('/');
		for (let i = pathParts.length - 1; i > 0; i--) {
			const parentPath = pathParts.slice(0, i).join('/');
			if (this.settings.lockedItems[parentPath]?.type === 'folder') {
				return parentPath;
			}
		}
		return path;
	}

	async removeLock(path: string) {
		delete this.settings.lockedItems[path];
		this.unlockedSessions.delete(path);
		await this.saveSettings();
		new Notice('🔓 Lock removed');
	}

	private lockFileSession(path: string) {
		// Remove the file from unlocked sessions, effectively locking it again
		const wasUnlocked = this.unlockedSessions.has(path);
		this.unlockedSessions.delete(path);
		this.clearBlur(path);
		
		// Show notice that file was auto-locked
		if (wasUnlocked) {
			const fileName = path.split('/').pop() || path;
			new Notice(`🔒 ${fileName} has been automatically locked`);
		}
		
		// Also remove unlock status for any parent folder sessions
		const pathParts = path.split('/');
		for (let i = pathParts.length - 1; i > 0; i--) {
			const parentPath = pathParts.slice(0, i).join('/');
			if (this.settings.lockedItems[parentPath]?.type === 'folder') {
				// Don't remove parent folder session unless no other files from that folder are open
				const openFilesInFolder = Array.from(this.openFiles).some(openPath => 
					openPath.startsWith(parentPath + '/') && openPath !== path
				);
				if (!openFilesInFolder) {
					this.unlockedSessions.delete(parentPath);
				}
				break;
			}
		}
	}

	private checkClosedFiles() {
		// Get currently open files
		const currentlyOpen = new Set<string>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() === 'markdown') {
				const file = (leaf.view as MarkdownView).file;
				if (file) {
					currentlyOpen.add(file.path);
				}
			}
		});

		// Find files that were open but are now closed
		const closedFiles = Array.from(this.openFiles).filter(path => !currentlyOpen.has(path));
		
		// Lock sessions for closed files that are locked (if auto-lock is enabled)
		if (this.settings.autoLockOnClose) {
			closedFiles.forEach(path => {
				if (this.isItemLocked(path)) {
					this.lockFileSession(path);
				}
			});
		}

		// Update the set of open files
		this.openFiles = currentlyOpen;
	}

	private updateOpenFiles() {
		// Update the tracking of currently open files
		this.openFiles.clear();
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() === 'markdown') {
				const file = (leaf.view as MarkdownView).file;
				if (file) {
					this.openFiles.add(file.path);
				}
			}
		});
	}

	private lockCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			this.promptLock(activeFile);
		} else {
			new Notice('No active file to lock');
		}
	}

	private unlockCurrentFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && this.isItemLocked(activeFile.path)) {
			this.promptUnlock(activeFile.path);
		} else {
			new Notice('Current file is not locked');
		}
	}
}

class PasswordSetModal extends Modal {
	plugin: LocketPlugin;
	file: TAbstractFile;

	constructor(app: App, plugin: LocketPlugin, file: TAbstractFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: `Lock ${this.file instanceof TFile ? 'File' : 'Folder'}: ${this.file.name}` });

		const passwordInput = contentEl.createEl('input', {
			type: 'password',
			placeholder: 'Enter password to lock this item',
			cls: 'locket-password-input'
		});

		const confirmInput = contentEl.createEl('input', {
			type: 'password',
			placeholder: 'Confirm password',
			cls: 'locket-password-input'
		});

		const buttonContainer = contentEl.createDiv('locket-button-container');

		const lockButton = buttonContainer.createEl('button', { 
			text: 'Lock',
			cls: 'locket-button locket-button-danger'
		});

		const cancelButton = buttonContainer.createEl('button', { 
			text: 'Cancel',
			cls: 'locket-button locket-button-secondary'
		});

		const handleLock = async () => {
			const password = passwordInput.value;
			const confirm = confirmInput.value;

			if (!password) {
				new Notice('Please enter a password');
				return;
			}

			if (password !== confirm) {
				new Notice('Passwords do not match');
				return;
			}

			await this.plugin.lockItem(this.file, password);
			this.close();
		};

		lockButton.addEventListener('click', handleLock);
		cancelButton.addEventListener('click', () => this.close());

		passwordInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				confirmInput.focus();
			}
		});

		confirmInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				handleLock();
			}
		});

		passwordInput.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class PasswordUnlockModal extends Modal {
	plugin: LocketPlugin;
	path: string;

	constructor(app: App, plugin: LocketPlugin, path: string) {
		super(app);
		this.plugin = plugin;
		this.path = path;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const fileName = this.path.split('/').pop() || this.path;
		contentEl.createEl('h2', { text: `🔒 Unlock: ${fileName}` });

		const passwordInput = contentEl.createEl('input', {
			type: 'password',
			placeholder: 'Enter password to unlock',
			cls: 'locket-password-input'
		});

		const buttonContainer = contentEl.createDiv('locket-button-container');

		const unlockButton = buttonContainer.createEl('button', { 
			text: 'Unlock',
			cls: 'locket-button locket-button-primary'
		});

		const cancelButton = buttonContainer.createEl('button', { 
			text: 'Cancel',
			cls: 'locket-button locket-button-secondary'
		});

		const handleUnlock = async () => {
			const password = passwordInput.value;

			if (!password) {
				new Notice('Please enter a password');
				return;
			}

			const success = await this.plugin.unlockItem(this.path, password);
			if (success) {
				this.close();
			} else {
				new Notice('❌ Incorrect password');
				passwordInput.value = '';
				passwordInput.focus();
			}
		};

		unlockButton.addEventListener('click', handleUnlock);
		cancelButton.addEventListener('click', () => this.close());

		passwordInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				handleUnlock();
			}
		});

		passwordInput.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class LocketManagerModal extends Modal {
	plugin: LocketPlugin;

	constructor(app: App, plugin: LocketPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '🔒 Locket Manager' });

		const lockedItems = Object.keys(this.plugin.settings.lockedItems);

		if (lockedItems.length === 0) {
			contentEl.createEl('p', { text: 'No locked items found. Right-click on files or folders to lock them.' });
			return;
		}

		const list = contentEl.createEl('div', { cls: 'locket-locked-items-list' });

		lockedItems.forEach(path => {
			const item = this.plugin.settings.lockedItems[path];
			const itemEl = list.createDiv('locket-item');

			const infoEl = itemEl.createDiv('locket-item-info');
			const typeIcon = item.type === 'file' ? '📄' : '📁';
			const fileName = path.split('/').pop() || path;
			
			const titleEl = infoEl.createEl('div', { cls: 'locket-item-title' });
			titleEl.createSpan({ text: typeIcon + ' ' });
			titleEl.createEl('strong', { text: fileName });
			
			const pathEl = infoEl.createEl('small', { 
				text: path, 
				cls: 'locket-item-path'
			});

			const actionsEl = itemEl.createDiv('locket-item-actions');

			const unlockBtn = actionsEl.createEl('button', { 
				text: 'Unlock',
				cls: 'locket-item-button locket-button-primary'
			});
			unlockBtn.addEventListener('click', () => {
				this.close();
				this.plugin.promptUnlock(path);
			});

			const removeBtn = actionsEl.createEl('button', { 
				text: 'Remove Lock',
				cls: 'locket-item-button locket-button-danger'
			});
			removeBtn.addEventListener('click', async () => {
				await this.plugin.removeLock(path);
				this.onOpen(); // Refresh the modal
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class LocketSettingTab extends PluginSettingTab {
	plugin: LocketPlugin;

	constructor(app: App, plugin: LocketPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Locket Settings' });

		new Setting(containerEl)
			.setName('Blur Intensity')
			.setDesc('How blurred locked content should appear (1-20)')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.blurIntensity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.blurIntensity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-lock on close')
			.setDesc('Automatically lock files when they are closed or when switching to other files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoLockOnClose)
				.onChange(async (value) => {
					this.plugin.settings.autoLockOnClose = value;
					await this.plugin.saveSettings();
				}));

		// Show locked items
		const lockedItems = Object.keys(this.plugin.settings.lockedItems);
		
		if (lockedItems.length > 0) {
			containerEl.createEl('h3', { text: 'Locked Items' });
			
			const listEl = containerEl.createEl('div', { cls: 'locket-settings-list' });

			lockedItems.forEach(path => {
				const item = this.plugin.settings.lockedItems[path];
				const itemEl = listEl.createDiv('locket-settings-item');

				const typeIcon = item.type === 'file' ? '📄' : '📁';
				const fileName = path.split('/').pop() || path;
				
				const infoEl = itemEl.createDiv('locket-settings-info');
				const titleEl = infoEl.createEl('div');
				titleEl.createSpan({ text: typeIcon + ' ' });
				titleEl.createEl('strong', { text: fileName });
				infoEl.createEl('small', { text: path, cls: 'locket-settings-path' });

				const removeBtn = itemEl.createEl('button', { 
					text: 'Remove',
					cls: 'locket-settings-remove-btn'
				});
				removeBtn.addEventListener('click', async () => {
					await this.plugin.removeLock(path);
					this.display(); // Refresh the settings
				});
			});
		}

		// Instructions
		containerEl.createEl('h3', { text: 'How to Use' });
		const instructions = containerEl.createEl('div', { cls: 'locket-instructions' });
		
		// To lock section
		const lockSection = instructions.createEl('div');
		lockSection.createEl('p').createEl('strong', { text: 'To lock a file or folder:' });
		const lockList = lockSection.createEl('ul');
		lockList.createEl('li', { text: 'Right-click on any file or folder in the file explorer' });
		lockList.createEl('li', { text: 'Select "🔒 Lock" from the context menu' });
		lockList.createEl('li', { text: 'Set a password for that item' });
		
		// To unlock section
		const unlockSection = instructions.createEl('div');
		unlockSection.createEl('p').createEl('strong', { text: 'To unlock:' });
		const unlockList = unlockSection.createEl('ul');
		unlockList.createEl('li', { text: 'Click on the unlock overlay when viewing a locked file' });
		unlockList.createEl('li', { text: 'Or right-click and select "🔓 Unlock"' });
		unlockList.createEl('li', { text: 'Or use the Manager (ribbon icon)' });
		
		// Auto-locking section
		const autoSection = instructions.createEl('div');
		autoSection.createEl('p').createEl('strong', { text: 'Auto-locking:' });
		const autoList = autoSection.createEl('ul');
		autoList.createEl('li', { text: 'When enabled, files are automatically locked when closed or when switching to other files' });
		autoList.createEl('li', { text: 'Files remain unlocked while open in multiple tabs' });
		autoList.createEl('li', { text: 'Turn off auto-locking if you prefer manual control' });
		
		// Note
		instructions.createEl('p').createEl('strong', { text: 'Note: Unlocked items remain accessible until you restart Obsidian or they are auto-locked.' });
	}
}
