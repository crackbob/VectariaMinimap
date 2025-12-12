let showPlants = false;

const minimap = document.createElement("canvas");
minimap.width = 200;
minimap.height = 200;
minimap.style.position = "fixed";
minimap.style.top = "10px";
minimap.style.right = "10px";
minimap.style.border = "2px solid white";
minimap.style.zIndex = 9999;
minimap.style.transformOrigin = "center center";
minimap.style.borderRadius = "50%";
document.body.appendChild(minimap);

const ctx = minimap.getContext("2d");

let provides = app._vnode.component.appContext.provides;
let appState = provides[Object.getOwnPropertySymbols(provides).find(sym => provides[sym]._s)];
let _stores = appState._s;
let blocks = _stores.get("gameState").gameWorld.allItems;
let chunkManager = _stores.get("gameState").gameWorld.chunkManager;

async function getAverageColor(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;

    img.onload = () => {
      const w = img.width;
      const h = img.height;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      function averageRegion(x, y, width, height) {
        const data = ctx.getImageData(x, y, width, height).data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
        return {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        };
      }

      const avg1 = averageRegion(0, 0, w, h / 2);
      const avg2 = averageRegion(0, h / 2, w, h / 2);

      const brightness = c => c.r * 0.299 + c.g * 0.587 + c.b * 0.114;

      resolve(brightness(avg2) > brightness(avg1) ? avg2 : avg1);
    };

    img.onerror = () => resolve(null);
  });
}

async function buildBlockColors() {
  const entries = Object.entries(blocks).map(([id, block]) => {
    const textureName = block.textures?.YP || block.textures?.other || block.name;
    const asset = Object.keys($assetsUrls).find(key => key.includes(textureName) && key.endsWith("png"));
    return [id, asset ? $assetsUrls[asset] : $assetsUrls[`defaultSurvival/renderItems/${id}.png`]];
  }).filter(Boolean);

  const result = {};

  await Promise.all(entries.map(async ([id, url]) => {
      let color = await getAverageColor(url);
      if (!color) color = { r: 0, g: 0, b: 0 };
      result[id] = color;
  }));

  return result;
}

const blockColors = await buildBlockColors();

const chunkSize = 16;
let cachedChunks = {};
let lastPlayerChunk = null;

function drawMinimap() {
  const playerPos = _stores.get("gameState").gameWorld.player.position;
  const playerRot = _stores.get("gameState").gameWorld.player.rotation.y;
  const size = 200;
  const viewRadius = 50;
  const blockSize = size / (viewRadius * 2);

  const deg = (playerRot * (180 / Math.PI)) % 360;
  minimap.style.transform = `rotate(${deg}deg)`;

  const playerChunkX = Math.floor(playerPos.x / chunkSize);
  const playerChunkZ = Math.floor(playerPos.z / chunkSize);

  if (!lastPlayerChunk || lastPlayerChunk.x !== playerChunkX || lastPlayerChunk.z !== playerChunkZ) {
    lastPlayerChunk = { x: playerChunkX, z: playerChunkZ };

    for (let cx = playerChunkX - 3; cx <= playerChunkX + 3; cx++) {
      for (let cz = playerChunkZ - 3; cz <= playerChunkZ + 3; cz++) {
        const key = `${cx},${cz}`;
        if (!cachedChunks[key]) {
          const topBlocks = [];
          for (let x = 0; x < chunkSize; x++) {
            topBlocks[x] = [];
            for (let z = 0; z < chunkSize; z++) {
              let worldX = cx * chunkSize + x;
              let worldZ = cz * chunkSize + z;
              let worldY = Math.floor(playerPos.y + 20);
              let block = 0;
              while (worldY >= 0) {
                const id = chunkManager.getBlock(worldX, worldY, worldZ);
                const blk = blocks[id];

                if (!id || !blk) {
                  worldY--;
                  continue;
                }

                const isWater  = blk.transparent === true && blk.physTransp === true;
                const isLeaves = blk.isLeaves === true;
                const isPlant  = blk.physTransp === true && !isLeaves && !isWater;

                if (isLeaves || isWater || !blk.physTransp || (showPlants && isPlant)) {
                  block = id;
                  break;
                }

                worldY--;
              }

              topBlocks[x][z] = block;
            }
          }
          cachedChunks[key] = { topBlocks };
        }
      }
    }
  }

  ctx.clearRect(0, 0, size, size);

  for (let x = -viewRadius; x < viewRadius; x++) {
    for (let z = -viewRadius; z < viewRadius; z++) {
      const worldX = Math.floor(playerPos.x + x);
      const worldZ = Math.floor(playerPos.z + z);

      const cx = Math.floor(worldX / chunkSize);
      const cz = Math.floor(worldZ / chunkSize);
      const chunkKey = `${cx},${cz}`;
      const chunk = cachedChunks[chunkKey];
      if (!chunk) continue;

      const bx = ((worldX % chunkSize) + chunkSize) % chunkSize;
      const bz = ((worldZ % chunkSize) + chunkSize) % chunkSize;
      const block = chunk.topBlocks[bx][bz];
      if (!block) continue;

      const color = blockColors[block] || { r: 100, g: 100, b: 100 };
      ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
      ctx.fillRect(
        (x + viewRadius) * blockSize,
        (z + viewRadius) * blockSize,
        blockSize,
        blockSize
      );
    }
  }

  const x = size / 2;
  const y = size / 2;

  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = "black";
  ctx.stroke();
}

requestAnimationFrame(function loop() {
  drawMinimap();
  requestAnimationFrame(loop);
});
