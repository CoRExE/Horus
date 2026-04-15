import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MotiView } from 'moti';
import Svg, { Path, Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  Easing 
} from 'react-native-reanimated';

type HorusBootSequenceProps = {
  onBootComplete: () => void;
};

export const HorusBootSequence = ({ onBootComplete }: HorusBootSequenceProps) => {
  // Séquencier : 1 = Assemblage | 2 = Pulse & Rotation | 3 = Glitch final
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Valeur partagée Reanimated pour une rotation infinie à 60fps
  const rotation = useSharedValue(0);

  useEffect(() => {
    // Démarrage de la rotation continue des anneaux dès le montage
    rotation.value = withRepeat(
      withTiming(360, { duration: 6000, easing: Easing.linear }),
      -1, // Infini
      false
    );

    // Orchestration par timeout pour coller exactement au scénario
    const t1 = setTimeout(() => setStep(2), 1500); // 1.5s: Fin assemblage, pulse activé
    const t2 = setTimeout(() => setStep(3), 3500); // 3.5s: Fin du boot, glitch trigger
    const t3 = setTimeout(() => onBootComplete(), 4000); // 4.0s: Callback final

    return () => { 
      clearTimeout(t1); 
      clearTimeout(t2); 
      clearTimeout(t3); 
    };
  }, [onBootComplete, rotation]);

  // Styles animés pour l'anneau fragmenté externe
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }]
  }));

  // Styles animés pour l'anneau fragmenté interne (tourne plus vite dans l'autre sens)
  const reverseRingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `-${rotation.value * 1.5}deg` }]
  }));

  // --- Design System Constants ---
  const COLOR_BG = '#0B0F19';
  const COLOR_PULSE = '#8B5CF6';
  const COLOR_STREAM = '#00FFFF';

  const isGlitching = step === 3;

  return (
    <View style={styles.container}>
      {/* Conteneur Maitre : Fait le flicker glitch à la fin */}
      <MotiView
        style={styles.canvasContainer}
        animate={{
          opacity: isGlitching ? [1, 0.2, 0.9, 0, 1, 0.3, 1] : 1,
          scale: isGlitching ? [1, 1.08, 0.95, 1.05, 1] : 1,
          translateX: isGlitching ? [0, -6, 5, -3, 4, 0] : 0,
        }}
        transition={{ type: 'timing', duration: 80 }}
      >
        <Svg viewBox="0 0 200 200" style={StyleSheet.absoluteFillObject}>
          <Defs>
             <RadialGradient id="pulseGlow" cx="50%" cy="50%" r="50%">
               <Stop offset="0%" stopColor={COLOR_PULSE} stopOpacity="0.35" />
               <Stop offset="100%" stopColor={COLOR_BG} stopOpacity="0" />
             </RadialGradient>
          </Defs>
        </Svg>

        {/* Lueur d'arrière-plan pulsante (Séquence 2) */}
        <MotiView 
             style={StyleSheet.absoluteFillObject}
             animate={{ opacity: step >= 2 ? [0.2, 0.7, 0.2] : 0 }}
             transition={{ loop: true, type: 'timing', duration: 2000 }}
        >
             <Svg viewBox="0 0 200 200">
               <Circle cx="100" cy="100" r="80" fill="url(#pulseGlow)" />
             </Svg>
        </MotiView>

        {/* Calque 1 : Anneaux de données (Data Stream Rings) */}
        <Animated.View style={[StyleSheet.absoluteFillObject, ringStyle]}>
          <Svg viewBox="0 0 200 200">
            {/* Outer Data Ring */}
            <Circle 
              cx="100" cy="100" r="95" 
              stroke={COLOR_STREAM} strokeWidth="1" strokeDasharray="30 15 5 10" 
              fill="none" opacity={0.8} 
            />
          </Svg>
        </Animated.View>
        
        <Animated.View style={[StyleSheet.absoluteFillObject, reverseRingStyle]}>
          <Svg viewBox="0 0 200 200">
            {/* Inner Fast Data Ring */}
            <Circle 
              cx="100" cy="100" r="85" 
              stroke={COLOR_STREAM} strokeWidth="1.5" strokeDasharray="2 10" 
              fill="none" opacity={0.5} 
            />
          </Svg>
        </Animated.View>

        {/* Calque 2 : Construct de la Pyramide (3 blocs disjoints formant un Y inversé vide au centre) */}
        
        {/* Composant Top */}
        <MotiView
          style={StyleSheet.absoluteFillObject}
          from={{ translateY: -100, opacity: 0 }}
          animate={{ translateY: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 60, delay: 100 }}
        >
          <Svg viewBox="0 0 200 200">
            <Path d="M 100 20 L 130 80 L 70 80 Z" fill="none" stroke={COLOR_STREAM} strokeWidth="2" />
            <Path d="M 100 25 L 125 75 L 75 75 Z" fill={COLOR_STREAM} opacity={0.15} />
          </Svg>
        </MotiView>

        {/* Composant Left Base */}
        <MotiView
          style={StyleSheet.absoluteFillObject}
          from={{ translateX: -80, translateY: 60, opacity: 0 }}
          animate={{ translateX: 0, translateY: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 60, delay: 300 }}
        >
          <Svg viewBox="0 0 200 200">
            <Path d="M 65 90 L 95 150 L 30 150 Z" fill="none" stroke={COLOR_STREAM} strokeWidth="2" />
            <Path d="M 65 95 L 90 145 L 35 145 Z" fill={COLOR_STREAM} opacity={0.15} />
          </Svg>
        </MotiView>

        {/* Composant Right Base */}
        <MotiView
          style={StyleSheet.absoluteFillObject}
          from={{ translateX: 80, translateY: 60, opacity: 0 }}
          animate={{ translateX: 0, translateY: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 60, delay: 500 }}
        >
          <Svg viewBox="0 0 200 200">
            <Path d="M 135 90 L 170 150 L 105 150 Z" fill="none" stroke={COLOR_STREAM} strokeWidth="2" />
            <Path d="M 135 95 L 165 145 L 110 145 Z" fill={COLOR_STREAM} opacity={0.15} />
          </Svg>
        </MotiView>

        {/* Calque 3 : La Pupille Centrale (Scanneur / Pulse) */}
        <MotiView
          style={StyleSheet.absoluteFillObject}
          from={{ scale: 0, opacity: 0 }}
          animate={{ 
             scale: step >= 2 ? [1, 1.25, 1] : 1, 
             opacity: step >= 2 ? [0.5, 1, 0.5] : 1 
          }}
          transition={
            step >= 2 
            ? { loop: true, type: 'timing', duration: 1200 }
            : { type: 'spring', delay: 1000 } // S'affiche à la toute fin de l'assemblage
          }
        >
          <Svg viewBox="0 0 200 200">
             {/* Forme de la pupille (Losange géométrique) au centre exact */}
             <Path d="M 100 85 L 115 105 L 100 125 L 85 105 Z" fill={COLOR_PULSE} />
             {/* Fente cybernétique de la pupille */}
             <Path d="M 100 95 L 100 115" stroke={COLOR_BG} strokeWidth="3" strokeLinecap="round" />
          </Svg>
        </MotiView>

      </MotiView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19', // Arrière plan strict
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasContainer: {
    width: 200,
    height: 200,
  }
});
