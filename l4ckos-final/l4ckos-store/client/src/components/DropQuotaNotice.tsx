import { Link } from "react-router-dom";
import { useCart } from "../contexts/CartContext";
import { describeDropGroup } from "../utils/dropQuota";
import "./DropQuotaNotice.css";

/** Exclusive-drop purchase limits for the current cart. Renders nothing when no limit is known (the server then decides at checkout). */
export function DropQuotaNotice() {
  const { dropQuota } = useCart();
  if (dropQuota.groups.length === 0) return null;
  return (
    <>
      {dropQuota.groups.map(group => {
        const { tone, text } = describeDropGroup(group);
        return (
          <div
            key={group.dropId}
            className={`l4-dropquota l4-dropquota--${tone}`}
            role={tone === "warning" ? "alert" : "status"}
            data-drop-quota={group.reason}
          >
            <strong>Drop exclusivo{group.cap !== null && group.reason !== "window_closed" && group.reason !== "needs_access" && group.reason !== "login_required" ? ` · limite ${group.cap}` : ""}</strong>
            <p>{text}</p>
            {group.reason === "login_required" ? (
              <div className="l4-dropquota-links"><Link to="/entrar?next=%2Fcarrinho">Entrar</Link></div>
            ) : group.reason === "needs_access" ? (
              <div className="l4-dropquota-links">
                {group.productIds.map(productId => <Link key={productId} to={`/produto/${productId}`}>Ver produto #{productId}</Link>)}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
