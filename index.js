let showPlants = false;
let size = 200;
let viewRadius = 50;
let renderDistance = 10;
let chunkLoadDistance = 3;
const chunkSize = 16;

const minimap = document.createElement("canvas");
minimap.width = size;
minimap.height = size;
Object.assign(minimap.style, {
    position: "fixed",
    top: "10px",
    left: "10px",
    border: "2px solid white",
    borderRadius: "50%",
    zIndex: 9999,
    backdropFilter: "blur(4px)",
    cursor: "grab",
    transformOrigin: "center center"
});
document.body.appendChild(minimap);

const ctx = minimap.getContext("2d");
ctx.imageSmoothingEnabled = false;

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

minimap.addEventListener("mousedown", e => {
    isDragging = true;
    dragOffsetX = e.clientX - minimap.offsetLeft;
    dragOffsetY = e.clientY - minimap.offsetTop;
    minimap.style.cursor = "grabbing";
    e.preventDefault();
});

window.addEventListener("mousemove", e => {
    if (!isDragging) return;
    minimap.style.left = e.clientX - dragOffsetX + "px";
    minimap.style.top = e.clientY - dragOffsetY + "px";
});

window.addEventListener("mouseup", () => {
    isDragging = false;
    minimap.style.cursor = "grab";
});

let provides = app._vnode.component.appContext.provides;
let appState = provides[Object.getOwnPropertySymbols(provides).find(sym => provides[sym]._s)];
let rawStores = appState._s;

let keys = ["app", "gameState", "friends", "settings", "sounds", "itemsManager", "roomManager", "modals", "user", "chat", "playerState", "ads"];

let values = [...rawStores.values()];
let stores = Object.fromEntries(keys.map((k, i) => [k, values[i]]));

let getBlocks = () => stores["gameState"]?.gameWorld?.allItems;
let getChunkManager = () => stores["gameState"]?.gameWorld?.chunkManager;
let getPlayer = () => stores["gameState"]?.gameWorld?.player;

async function waitForBlocks() {
    while (!getBlocks()) {
        await new Promise(r => setTimeout(r, 100));
    }
    return getBlocks();
}

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
                let r = 0,
                    g = 0,
                    b = 0,
                    count = 0;

                for (let i = 0; i < data.length; i += 4) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
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
    const blocks = await waitForBlocks();
    const entries = Object.entries(blocks).map(([id, block]) => {
        const textureName = block.textures?.YP || block.textures?.other || block.name;
        const asset = Object.keys($assetsUrls).find(key => key.includes(textureName) && key.endsWith("png"));
        return [id, asset ? $assetsUrls[asset] : $assetsUrls[`defaultSurvival/renderItems/${id}.png`]];
    }).filter(Boolean);

    const result = {};

    await Promise.all(entries.map(async ([id, url]) => {
        let color = await getAverageColor(url);
        if (!color) color = {
            r: 255,
            g: 0,
            b: 0
        };
        result[id] = color;
    }));

    return result;
}

const blockColors = await buildBlockColors();

function buildChunkCanvas(topBlocks) {
    const c = document.createElement("canvas");
    c.width = chunkSize;
    c.height = chunkSize;
    const cctx = c.getContext("2d");
    cctx.imageSmoothingEnabled = false;

    const img = cctx.createImageData(chunkSize, chunkSize);
    const d = img.data;

    for (let x = 0; x < chunkSize; x++) {
        for (let z = 0; z < chunkSize; z++) {
            const block = topBlocks[x][z].id;
            const col = blockColors[block];
            const i = (z * chunkSize + x) * 4;

            if (!block || !col) {
                d[i + 3] = 0;
                continue;
            }

            d[i]     = col.r;
            d[i + 1] = col.g;
            d[i + 2] = col.b;
            d[i + 3] = 255;
        }
    }

    cctx.putImageData(img, 0, 0);
    return c;
}


let cachedChunks = {};
let lastPlayerChunk = null;


function drawMinimap() {
    const player = getPlayer();
    if (!player) return;

    const { x: px, y: py, z: pz } = player.position;
    const rot = player.rotation.y;
    const blockSize = size / (viewRadius * 2);

    minimap.style.transform = `rotate(${rot * 180 / Math.PI}deg)`;

    const pcx = Math.floor(px / chunkSize);
    const pcz = Math.floor(pz / chunkSize);

    if (!lastPlayerChunk || lastPlayerChunk.x !== pcx || lastPlayerChunk.z !== pcz) {
        lastPlayerChunk = { x: pcx, z: pcz };

        for (let cx = pcx - chunkLoadDistance; cx <= pcx + chunkLoadDistance; cx++) {
            for (let cz = pcz - chunkLoadDistance; cz <= pcz + chunkLoadDistance; cz++) {
                const key = `${cx},${cz}`;
                if (cachedChunks[key]) continue;

                const topBlocks = Array.from({ length: chunkSize }, () => Array(chunkSize));
                let hasData = false;

                for (let x = 0; x < chunkSize; x++) {
                    for (let z = 0; z < chunkSize; z++) {
                        let wx = cx * chunkSize + x;
                        let wz = cz * chunkSize + z;
                        let wy = Math.floor(py + 20);
                        let block = 0;

                        while (wy >= 0) {
                            const id = getChunkManager()?.getBlock(wx, wy, wz);
                            const blk = getBlocks()?.[id];
                            if (!id || !blk) { wy--; continue; }

                            const isWater = blk.transparent && blk.physTransp;
                            const isLeaves = blk.isLeaves;
                            const isPlant = blk.physTransp && !isLeaves && !isWater;

                            if (isLeaves || isWater || !blk.physTransp || (showPlants && isPlant)) {
                                block = id;
                                hasData = true;
                                break;
                            }
                            wy--;
                        }

                        topBlocks[x][z] = { id: block };
                    }
                }

                if (hasData) {
                    cachedChunks[key] = {
                        canvas: buildChunkCanvas(topBlocks)
                    };
                } else {
                    setTimeout(() => delete cachedChunks[key], 1000);
                }
            }
        }
    }

    ctx.clearRect(0, 0, size, size);

    for (let cx = pcx - renderDistance; cx <= pcx + renderDistance; cx++) {
        for (let cz = pcz - renderDistance; cz <= pcz + renderDistance; cz++) {
            const key = `${cx},${cz}`;
            const chunk = cachedChunks[key];
            if (!chunk) continue;

            const dx = Math.floor((cx * chunkSize - px + viewRadius) * blockSize);
            const dz = Math.floor((cz * chunkSize - pz + viewRadius) * blockSize);
            const dw = Math.ceil(chunkSize * blockSize) + 1;
            const dh = Math.ceil(chunkSize * blockSize) + 1;

            ctx.drawImage(chunk.canvas, dx, dz, dw, dh);

        }
    }

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.stroke();
}

(function loop() {
    drawMinimap();
    requestAnimationFrame(loop);
})();
