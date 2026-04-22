const faviconSelector = 'link[rel="icon"]';

function getFaviconLinks() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>(faviconSelector));
}

function rememberOriginalFavicon(link: HTMLLinkElement) {
  if (!link.dataset.originalHref) {
    link.dataset.originalHref = link.getAttribute("href") || "";
  }

  if (!link.dataset.originalType) {
    link.dataset.originalType = link.getAttribute("type") || "";
  }
}

function restoreOriginalFavicons() {
  for (const link of getFaviconLinks()) {
    if (link.dataset.originalHref !== undefined) {
      link.setAttribute("href", link.dataset.originalHref);
    }

    if (link.dataset.originalType) {
      link.setAttribute("type", link.dataset.originalType);
    } else {
      link.removeAttribute("type");
    }
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load favicon source: ${src}`));
    image.src = src;
  });
}

async function createBadgedFavicon(src: string, size: number) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create favicon badge context.");
  }

  canvas.width = size;
  canvas.height = size;
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);

  const badgeRadius = size <= 16 ? 4 : 6;
  const badgeCenterX = size - badgeRadius - 1;
  const badgeCenterY = badgeRadius + 1;

  context.beginPath();
  context.fillStyle = "#ffffff";
  context.arc(badgeCenterX, badgeCenterY, badgeRadius + 1.5, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.fillStyle = "#d93025";
  context.arc(badgeCenterX, badgeCenterY, badgeRadius, 0, Math.PI * 2);
  context.fill();

  return canvas.toDataURL("image/png");
}

export async function updateFaviconBadge(unreadCount: number) {
  const faviconLinks = getFaviconLinks();

  if (faviconLinks.length === 0) {
    return;
  }

  for (const link of faviconLinks) {
    rememberOriginalFavicon(link);
  }

  if (unreadCount <= 0) {
    restoreOriginalFavicons();
    return;
  }

  const sizedLinks = faviconLinks.map((link) => ({
    href: link.dataset.originalHref || link.getAttribute("href") || "",
    link,
    size: (() => {
      const declaredSize = Number.parseInt(link.getAttribute("sizes") || "", 10);

      if (Number.isFinite(declaredSize) && declaredSize > 0) {
        return declaredSize;
      }

      return (link.getAttribute("href") || "").includes("16") ? 16 : 32;
    })()
  }));

  await Promise.all(
    sizedLinks.map(async ({ link, href, size }) => {
      const resolvedHref = new URL(href || "/favicon-32.png", window.location.href).toString();
      const badgedHref = await createBadgedFavicon(resolvedHref, size);
      link.setAttribute("href", badgedHref);
      link.setAttribute("type", "image/png");
    })
  );
}
