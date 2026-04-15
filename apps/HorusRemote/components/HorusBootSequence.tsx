import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import { MotiView } from 'moti';
import Svg, { Path, Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

type HorusBootSequenceProps = {
  onBootComplete: () => void;
};

// Séquence de lignes du Terminal 
const SYSTEM_LINES = [
  "HORUS KERNEL v9.0.1",
  "INITIALIZING BOOT SEQUENCE...",
  "MOUNTING /dev/sda1... OK",
  "LOADING NEURAL NETWORKS... 100%",
  "BYPASSING FIREWALL... DONE",
  "CONNECTING TO DATASTREAM...",
  "ANALYZING METADATA...",
  "SYSTEM OVERLOAD WARNING",
  "ATTEMPTING RECOVERY...",
];

const ERROR_LINES = [
  "FATAL EXCEPTION: 0x0000000000",
  "SEGMENTATION FAULT",
  "KERNEL PANIC: VFS UNABLE TO MOUNT",
  "[FAILED] TO LOAD NVRAM",
  "MEMORY CORRUPTION DETECTED",
  "OVERRIDE DENIED",
  "CORE TEMP CRITICAL: 98C",
  "DATABUS ERROR TRACE",
];

export const HorusBootSequence = ({ onBootComplete }: HorusBootSequenceProps) => {
  // Séquencier : 1 = Terminal | 2 = Error Code Spam | 3 = Eye Reveal
  const [phase, setPhase] = useState<1 | 2 | 3>(1);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);

  useEffect(() => {
    let currentLineIndex = 0;
    let errorLineIndex = 0;
    let activeInterval: NodeJS.Timeout;
    
    // 1. Spawner de texte Terminal 
    activeInterval = setInterval(() => {
      if (currentLineIndex < SYSTEM_LINES.length) {
        setTerminalLines(prev => [...prev, SYSTEM_LINES[currentLineIndex]]);
        currentLineIndex++;
      }
    }, 200);

    // 2. Erreur Système (Bug Rouge + Spam) à 2000ms
    const t1 = setTimeout(() => {
      setPhase(2);
      clearInterval(activeInterval);
      
      activeInterval = setInterval(() => {
        setTerminalLines(prev => {
          const newLines = [...prev, ERROR_LINES[errorLineIndex % ERROR_LINES.length]];
          // Limiter le nombre de lignes à 25 pour ne pas exploser la RAM avec le spam
          return newLines.length > 25 ? newLines.slice(newLines.length - 25) : newLines;
        });
        errorLineIndex++;
      }, 30); // 30ms = spam très rapide
    }, 2000);

    // 3. Apparition de l'OEil à 2800ms
    const t2 = setTimeout(() => {
      setPhase(3);
      clearInterval(activeInterval);
    }, 2800);

    // Fin du composant à 4500ms
    const t3 = setTimeout(() => {
      onBootComplete(); 
    }, 4500);

    return () => {
      clearInterval(activeInterval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onBootComplete]);

  // Constantes de design
  const COLOR_BG = '#0B0F19';
  const COLOR_CYAN = '#00FFFF';
  const COLOR_PURPLE = '#8B5CF6';
  const COLOR_RED = '#EF4444';

  const isError = phase === 2;
  const isRevealed = phase === 3;
  const isErrorOrLater = phase >= 2;

  const currentTextColor = isErrorOrLater ? COLOR_RED : COLOR_CYAN;
  const currentTextShadow = isErrorOrLater ? 'rgba(239, 68, 68, 0.6)' : 'rgba(0, 255, 255, 0.4)';

  return (
    <View style={styles.container}>
      
      {/* PHASE 1 & 2 : Terminal Output & Spam */}
      <MotiView
        style={styles.terminalContainer}
        animate={{
          opacity: isRevealed ? 0.1 : 1, // Le terminal passe à 10% d'opacité en phase 3
        }}
        transition={{
          type: 'timing',
          duration: 800, // Fade out en douceur
        }}
        pointerEvents="none"
      >
        <View style={styles.lineContainer}>
          {terminalLines.map((line, index) => (
            <Text 
              key={`${index}-${line}`} 
              style={[
                styles.terminalLine, 
                { color: currentTextColor, textShadowColor: currentTextShadow }
              ]}
            >
              {isErrorOrLater ? '[ERR] ' : '> '} {line}
            </Text>
          ))}
        </View>
      </MotiView>

      {/* PHASE 3 : The Eye Reveal */}
      {isRevealed && (
        <MotiView
          style={styles.eyeContainer}
          from={{ opacity: 0, scale: 0.2 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 80 }}
          pointerEvents="none"
        >
          {/* Lueur Pulsante de l'œil */}
          <MotiView
            style={StyleSheet.absoluteFillObject}
            animate={{ scale: [1, 1.05, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ loop: true, type: 'timing', duration: 1500 }}
          >
            <Svg viewBox="0 0 200 200" style={StyleSheet.absoluteFillObject}>
              <Defs>
                <RadialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={COLOR_PURPLE} stopOpacity="0.5" />
                  <Stop offset="100%" stopColor={COLOR_BG} stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle cx="100" cy="100" r="70" fill="url(#eyeGlow)" />
            </Svg>
          </MotiView>

          {/* Squelette SVG de l'OEil Cybernétique */}
          <Svg viewBox="0 0 200 200" style={{ width: 200, height: 200, zIndex: 10 }}>
            {/* Contour Externe principal (Losange effilé) */}
            <Path 
               d="M 10 100 Q 100 10 190 100 Q 100 190 10 100 Z" 
               fill="none" 
               stroke={COLOR_CYAN} 
               strokeWidth="2" 
            />
            {/* Contour pointillé interne */}
            <Path 
               d="M 30 100 Q 100 40 170 100 Q 100 160 30 100 Z" 
               fill="none" 
               stroke={COLOR_CYAN} 
               strokeWidth="1.5" 
               strokeDasharray="4 6" 
               opacity={0.6} 
            />
            
            {/* Cercles concentriques de l'Iris */}
            <Circle cx="100" cy="100" r="35" fill="none" stroke={COLOR_CYAN} strokeWidth="2" />
            <Circle cx="100" cy="100" r="28" fill="none" stroke={COLOR_PURPLE} strokeWidth="1" strokeDasharray="2 4" />
            <Circle cx="100" cy="100" r="22" fill="none" stroke={COLOR_PURPLE} strokeWidth="3" opacity={0.8} />

            {/* Pupille Fendue Electronique */}
            <Path d="M 100 70 L 112 100 L 100 130 L 88 100 Z" fill={COLOR_PURPLE} />
            <Circle cx="100" cy="100" r="4" fill={COLOR_BG} />
          </Svg>
        </MotiView>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  // --- TERMINAL ---
  terminalContainer: {
    ...StyleSheet.absoluteFillObject,
    padding: 30,
    paddingTop: 80,
  },
  lineContainer: {
    justifyContent: 'flex-end',
    flexDirection: 'column',
  },
  terminalLine: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
    letterSpacing: 1,
  },
  // --- EYE ---
  eyeContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
  }
});
