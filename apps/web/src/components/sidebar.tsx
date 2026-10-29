import symbole from '../assets/icons/zelo-symbole.svg';
import { navigate, type Route, useRoute } from '../lib/router';
import { Icon, type IconName } from './icon';
import s from './sidebar.module.css';

const LINKS: { to: Route; label: string; icon: IconName }[] = [
  { to: '/', label: 'Vue d’ensemble', icon: 'home' },
  { to: '/stationnement', label: 'Stationnement', icon: 'parking' },
  { to: '/recharge', label: 'Recharge', icon: 'recharge' },
  { to: '/carburant', label: 'Carburant', icon: 'carburant' },
  { to: '/signalements', label: 'Signalements', icon: 'signalement' },
  { to: '/api', label: 'API & données', icon: 'reglages' },
];

export function Sidebar() {
  const route = useRoute();
  return (
    <nav className={s.bar} aria-label="Sections">
      <div className={s.logo}>
        <span className={s.appIcon}>
          <img src={symbole} alt="" />
        </span>
        <span>
          <span className={s.name}>Zelo Ville</span>
          <br />
          <span className={s.sub}>Grand Reims</span>
        </span>
      </div>
      {LINKS.map((l) => (
        <a
          key={l.to}
          href={l.to}
          className={s.link}
          aria-current={route === l.to ? 'page' : undefined}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            navigate(l.to);
          }}
        >
          <Icon name={l.icon} />
          {l.label}
        </a>
      ))}
      <div className={s.account}>
        <span className={s.avatar} aria-hidden="true">
          P
        </span>
        <span>
          <span className={s.accountName}>Accès public</span>
          <br />
          <span className={s.accountSub}>Lecture seule, sans compte</span>
        </span>
      </div>
    </nav>
  );
}
