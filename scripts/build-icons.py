from pathlib import Path
from PIL import Image

asset_dir = Path(__file__).resolve().parent.parent / 'assets'
source = Image.open(asset_dir / 'icon.png').convert('RGBA')
source.save(asset_dir / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
source.save(asset_dir / 'icon.icns')
print('Created assets/icon.ico and assets/icon.icns')
