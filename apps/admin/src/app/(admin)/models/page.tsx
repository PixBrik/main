import { StatusBadge } from "@/components/status-badge";
import {
  AttachModelVersionForm,
  CategoryVisibilityForm,
  CreateModelCategoryForm,
  CreateModelItemForm,
  ModelItemStatusForm,
  ModelVersionStatusForm
} from "@/components/models/model-library-forms";
import styles from "@/components/models/model-library.module.css";
import { hasPermission, requirePermission } from "@/lib/auth";
import {
  getModelLibrarySnapshot,
  type ModelLibraryStatus,
  type ModelLibraryVersion
} from "@/lib/model-library";

export const dynamic = "force-dynamic";

const ITEM_TRANSITIONS: Readonly<Record<ModelLibraryStatus, readonly ModelLibraryStatus[]>> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["retired"],
  retired: ["draft"]
};

const VERSION_TRANSITIONS: Readonly<Record<ModelLibraryStatus, readonly ModelLibraryStatus[]>> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["retired"],
  retired: ["review"]
};

function statusClass(status: ModelLibraryStatus): string {
  if (status === "published") return `${styles.tag} ${styles.tagPublished}`;
  if (status === "retired") return `${styles.tag} ${styles.tagRetired}`;
  return styles.tag;
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDimensions(version: Pick<ModelLibraryVersion, "widthMm" | "heightMm" | "depthMm">): string {
  if (version.widthMm === undefined || version.heightMm === undefined || version.depthMm === undefined) return "Not recorded";
  return `${version.widthMm} × ${version.heightMm} × ${version.depthMm} mm`;
}

function versionTransitions(version: ModelLibraryVersion, itemStatus: ModelLibraryStatus): readonly ModelLibraryStatus[] {
  if (itemStatus === "retired") return [];
  if (version.status === "published" && itemStatus === "published") return [];
  return VERSION_TRANSITIONS[version.status];
}

export default async function ModelLibraryPage() {
  const principal = await requirePermission("models.read");
  const canPublish = hasPermission(principal, "models.publish");
  const snapshot = await getModelLibrarySnapshot();
  const publishedItems = snapshot.items.filter((item) => item.status === "published").length;
  const reviewItems = snapshot.items.filter((item) => item.status === "review").length;
  const publishedVersions = snapshot.versions.filter((version) => version.status === "published").length;
  const itemStatus = new Map(snapshot.items.map((item) => [item.id, item.status]));

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Production / Reusable assets</span>
          <h1>Model library.</h1>
          <p>
            Categorize reusable designs, promote locked approved builds into versioned library assets,
            then review and publish them to the buyer experience.
          </p>
        </div>
        <StatusBadge tone="ready">PostgreSQL live</StatusBadge>
      </div>

      <section className="grid-4" aria-label="Model library summary">
        <article className="metric-card">
          <span className="eyebrow">Categories</span>
          <strong>{snapshot.categories.length}</strong>
          <small>{snapshot.categories.filter((category) => category.enabled).length} enabled</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Library models</span>
          <strong>{snapshot.items.length}</strong>
          <small>{reviewItems} waiting for review</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Published</span>
          <strong>{publishedItems}</strong>
          <small>{publishedVersions} live versions</small>
        </article>
        <article className="metric-card">
          <span className="eyebrow">Ready to attach</span>
          <strong>{snapshot.eligibleBuildVersions.length}</strong>
          <small>locked approved build versions</small>
        </article>
      </section>

      {canPublish ? (
        <section className="grid-2" aria-label="Create model-library records">
          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Taxonomy</span>
                <h2>Create a category</h2>
              </div>
              <span className="mono">Multilingual</span>
            </div>
            <p className={styles.sectionCopy}>
              Start with categories such as People, Pets, Vehicles, Objects or Art—or use the taxonomy that fits the catalogue.
            </p>
            <CreateModelCategoryForm categories={snapshot.categories} />
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Catalogue entry</span>
                <h2>Create a model</h2>
              </div>
              <span className="mono">Starts as draft</span>
            </div>
            <p className={styles.sectionCopy}>
              A model is the customer-facing library entry. Its 3D and brick output arrives through an approved build version below.
            </p>
            <CreateModelItemForm categories={snapshot.categories} />
          </article>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="model-version-create-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Approved build → library</span>
            <h2 id="model-version-create-title">Attach a production-ready version</h2>
          </div>
          <span className="mono">Immutable source build</span>
        </div>
        {!canPublish ? (
          <div className={styles.emptyBox}>
            <strong>Read-only access</strong>
            <span className={styles.emptyCopy}>A production or owner role with model publishing access can attach and publish versions.</span>
          </div>
        ) : snapshot.items.length === 0 ? (
          <div className={styles.emptyBox}>
            <strong>Create the first model above</strong>
            <span className={styles.emptyCopy}>The model entry must exist before an approved build can become one of its versions.</span>
          </div>
        ) : snapshot.eligibleBuildVersions.length === 0 ? (
          <div className={styles.emptyBox}>
            <strong>No approved build is ready yet</strong>
            <span className={styles.emptyCopy}>
              Review a generated 3D/brick build in Build queue and lock it as approved. It will then appear here automatically.
            </span>
          </div>
        ) : (
          <AttachModelVersionForm
            items={snapshot.items.map((item) => ({ id: item.id, title: item.title, status: item.status }))}
            builds={snapshot.eligibleBuildVersions.map((build) => ({
              id: build.id,
              title: build.buildTitle,
              versionNumber: build.versionNumber,
              brickCount: build.brickCount,
              provider: build.provider
            }))}
          />
        )}
      </section>

      <section className="panel" aria-labelledby="model-categories-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Taxonomy</span>
            <h2 id="model-categories-title">Categories</h2>
          </div>
          <span className="mono">{snapshot.categories.length} total</span>
        </div>
        {snapshot.categories.length === 0 ? (
          <div className={styles.emptyBox}>
            <strong>No categories yet</strong>
            <span className={styles.emptyCopy}>Use the form above to create a real category; no sample records are fabricated.</span>
          </div>
        ) : (
          <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Model categories table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Parent</th>
                  <th scope="col">Order</th>
                  <th scope="col">Models</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.categories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{category.name}</strong>
                        <small>/{category.slug}</small>
                      </div>
                    </td>
                    <td>{category.parentName ?? "—"}</td>
                    <td>{category.sortOrder}</td>
                    <td>{category.itemCount}</td>
                    <td><span className={category.enabled ? `${styles.tag} ${styles.tagPublished}` : `${styles.tag} ${styles.tagRetired}`}>{category.enabled ? "enabled" : "disabled"}</span></td>
                    <td>{canPublish ? <CategoryVisibilityForm categoryId={category.id} categoryName={category.name} enabled={category.enabled} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="model-items-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Customer-facing entries</span>
            <h2 id="model-items-title">Models</h2>
          </div>
          <span className="mono">{snapshot.items.length} total</span>
        </div>
        {snapshot.items.length === 0 ? (
          <div className={styles.emptyBox}>
            <strong>No model entries yet</strong>
            <span className={styles.emptyCopy}>Create a draft model above, then attach and publish an approved build version.</span>
          </div>
        ) : (
          <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Library models table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Versions</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Workflow</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className={styles.primaryCell}>
                        <strong>{item.title}</strong>
                        <small>/{item.slug}</small>
                        {item.description ? <small>{item.description}</small> : null}
                      </div>
                    </td>
                    <td>{item.categoryName ?? "Uncategorized"}</td>
                    <td><span className={statusClass(item.status)}>{item.status}</span></td>
                    <td>
                      {item.versionCount}
                      <small className={styles.muted}>{item.publishedVersionCount} published</small>
                    </td>
                    <td>{formatDate(item.updatedAt)}</td>
                    <td>
                      {canPublish ? <ModelItemStatusForm itemId={item.id} itemTitle={item.title} nextStatuses={ITEM_TRANSITIONS[item.status]} /> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="model-versions-title">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Versioned production output</span>
            <h2 id="model-versions-title">Library versions</h2>
          </div>
          <span className="mono">{snapshot.versions.length} total</span>
        </div>
        {snapshot.versions.length === 0 ? (
          <div className={styles.emptyBox}>
            <strong>No versions attached yet</strong>
            <span className={styles.emptyCopy}>Approved build versions appear in the promotion form above; attach one without duplicating its source data.</span>
          </div>
        ) : (
          <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Model library versions table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Library version</th>
                  <th scope="col">Source build</th>
                  <th scope="col">Brick specification</th>
                  <th scope="col">Status</th>
                  <th scope="col">Published</th>
                  <th scope="col">Workflow</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.versions.map((version) => {
                  const parentStatus = itemStatus.get(version.itemId) ?? "retired";
                  const nextStatuses = versionTransitions(version, parentStatus);
                  return (
                    <tr key={version.id}>
                      <td>
                        <div className={styles.primaryCell}>
                          <strong>{version.itemTitle} · v{version.versionNumber}</strong>
                          <small>{version.id}</small>
                        </div>
                      </td>
                      <td>
                        <div className={styles.primaryCell}>
                          <strong>{version.buildTitle} · build v{version.buildVersionNumber}</strong>
                          <small>{version.provider ?? "Provider not recorded"} · {version.buildVersionStatus}</small>
                          <small>{version.catalogRelease ?? "Catalog release not recorded"}</small>
                        </div>
                      </td>
                      <td>
                        {version.brickCount === undefined ? "Not recorded" : `${version.brickCount.toLocaleString()} bricks`}
                        <small className={styles.muted}>{formatDimensions(version)}</small>
                      </td>
                      <td><span className={statusClass(version.status)}>{version.status}</span></td>
                      <td>{formatDate(version.publishedAt)}</td>
                      <td>
                        {canPublish && nextStatuses.length > 0 ? (
                          <ModelVersionStatusForm
                            versionId={version.id}
                            versionLabel={`${version.itemTitle} version ${version.versionNumber}`}
                            nextStatuses={nextStatuses}
                          />
                        ) : (
                          <span className={styles.muted}>
                            {version.status === "published" && parentStatus === "published" ? "Live version—publish a replacement or retire its model." : "No action available"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
