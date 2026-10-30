"use client";

import dynamic from "next/dynamic";

// O simulador guarda palpites no localStorage: renderiza só no navegador para não divergir do HTML do servidor.
const SimulatorClient = dynamic(() => import("./Simulator"), {
  ssr: false,
  loading: () => <div className="h-96 card animate-pulse" />,
});

export default SimulatorClient;
