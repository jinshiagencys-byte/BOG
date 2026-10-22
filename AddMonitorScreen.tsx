import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  StatusBar,
  Animated,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Appbar, Switch, Text, Button, Surface, Checkbox } from 'react-native-paper';
import { Folder, Link as LinkIcon, AlertTriangle, ArrowLeft, User, Clock, Code, Bell } from 'lucide-react-native';
import { toastiva } from 'toastiva';
import CustomTextField from '../components/CustomTextField';
import {
  discoverPages,
  createMonitorGroup,
  createMonitor,
  RelayError,
  type DiscoveredPage,
} from '../api/relayClient';

const theme = {
  colors: {
    background: '#0F1115',
    surface: '#1A1E27',
    surfaceVariant: '#202833',
    primary: '#7DD3FC',
    onPrimary: '#082F49',
    onBackground: '#F8FAFC',
    onSurface: '#F8FAFC',
    outline: '#384456',
    textMuted: '#A6B0BF',
    error: '#FCA5A5',
    skeleton: '#202833',
    skeletonHighlight: '#384456',
  },
};

type ScreenStatus = 'idle' | 'crawling' | 'discovered' | 'submitting';

const SkeletonLoader: React.FC = () => {
  const waveAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: false,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [waveAnim]);
  const leftPosition = waveAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 400],
  });
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4].map((item) => (
        <View key={item} style={styles.skeletonItem}>
          <View style={[styles.skeletonCheckbox, { overflow: 'hidden' }]}>
            <Animated.View style={[styles.skeletonWave, { left: leftPosition }]} />
          </View>
          <View style={[styles.skeletonLine, { overflow: 'hidden' }]}>
            <Animated.View style={[styles.skeletonWave, { left: leftPosition }]} />
          </View>
        </View>
      ))}
    </View>
  );
};

export default function AddMonitorScreen({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [url, setUrl] = useState('');
  const [assignee, setAssignee] = useState('');
  const [frequency, setFrequency] = useState('');
  const [notificationFrequency, setNotificationFrequency] = useState('');
  const [scanInternalPages, setScanInternalPages] = useState(false);
  const [status, setStatus] = useState<ScreenStatus>('idle');
  const [pages, setPages] = useState<DiscoveredPage[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const allSelected = pages.length > 0 && selectedUrls.size === pages.length;
  const someSelected = selectedUrls.size > 0 && !allSelected;

  // 👇 CORRIGÉ : si la découverte s'est terminée mais n'a trouvé aucune page
  // (site protégé contre le crawl, pas de sitemap, etc.), on autorise quand
  // même la création — le relay se charge de se rabattre sur la page d'accueil.
  const noPagesFound = status === 'discovered' && pages.length === 0;

  const isFormValid =
    groupName.trim().length > 0 &&
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    assignee.trim().length > 0 &&
    frequency.trim().length > 0 &&
    !Number.isNaN(Number(frequency)) &&
    Number(frequency) > 0 &&
    notificationFrequency.trim().length > 0 &&
    !Number.isNaN(Number(notificationFrequency)) &&
    Number(notificationFrequency) > 0 &&
    status !== 'crawling' &&
    status !== 'submitting' &&
    (!scanInternalPages || noPagesFound || (status === 'discovered' && selectedUrls.size > 0));

  const resetDiscovery = () => {
    setPages([]);
    setSelectedUrls(new Set());
    setStatus('idle');
  };



  // Toggle pages
  const handleToggleScan = async (value: boolean) => {
    setError(null);
    if (!value) {
      setScanInternalPages(false);
      resetDiscovery();
      return;
    }
    if (!url.trim()) {
      setError('Renseigne une URL avant d’activer le scan.');
      return;
    }
    setScanInternalPages(true);
    setStatus('crawling');
    resetDiscovery();
    try {
      const discovered = await discoverPages(url.trim());
      setPages(discovered);
      setSelectedUrls(new Set(discovered.map((p) => p.url)));
      setStatus('discovered');
    } catch (err) {
      setError(err instanceof RelayError ? err.message : 'Erreur pendant le scan du site.');
      setScanInternalPages(false);
      setStatus('idle');
    }
  };



  const toggleSelectAll = () => {
    setSelectedUrls(allSelected ? new Set() : new Set(pages.map((p) => p.url)));
  };

  const togglePage = (pageUrl: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) next.delete(pageUrl);
      else next.add(pageUrl);
      return next;
    });
  };



  // Soumission
  const handleSubmit = async () => {
    if (!isFormValid) return;
    setStatus('submitting');
    setError(null);
    try {
      // On crée toujours un groupe (même sans pages internes).
      // Si aucune page n'a été sélectionnée/découverte, le relay créé
      // automatiquement un monitor sur l'URL principale.
      const selectedPages = scanInternalPages
        ? pages.filter((p) => selectedUrls.has(p.url))
        : [];
      const result = await createMonitorGroup(name.trim(), groupName.trim(), url.trim(), selectedPages, assignee.trim(), frequency, notificationFrequency);
      const workflowDispatch = result.workflowDispatch;
      if (workflowDispatch?.triggered) {
        toastiva.success('Monitor créé avec succès', {
          description: `La vérification de ${groupName.trim()} a démarré`,
          duration: 4000,
        });
      } else {
        let dispatchMessage = 'Monitor créé, mais le relay ne confirme pas le lancement du contrôle QA.';
        if (workflowDispatch?.reason === 'missing_configuration') {
          dispatchMessage = 'Monitor créé, mais le relay ne dispose pas de la configuration GitHub pour lancer le contrôle.';
        } else if (workflowDispatch?.status) {
          dispatchMessage = `Monitor créé, mais GitHub a refusé le lancement (HTTP ${workflowDispatch.status}). Vérifie les logs du relay.`;
        } else if (workflowDispatch?.reason === 'network_error') {
          dispatchMessage = 'Monitor créé, mais le relay n’a pas pu joindre GitHub. Vérifie les logs du relay.';
        }
        toastiva.error('Monitor créé, contrôle QA non lancé', {
          description: dispatchMessage,
          duration: 4000,
        });
      }

      onBack();
    } catch (err) {
      const msg = err instanceof RelayError ? err.message : 'Erreur pendant la création.';
      setError(msg);
      toastiva.error(msg);
      setStatus(scanInternalPages ? 'discovered' : 'idle');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.background} />
      {/* The SafeAreaView above already applies the top inset, so we disable
          Paper's own status-bar padding to avoid stacking both. */}
      <Appbar.Header statusBarHeight={0} style={{ backgroundColor: theme.colors.background }}>
        <Appbar.Action
          icon={() => <ArrowLeft color={theme.colors.onBackground} size={24} />}
          onPress={onBack}
        />
        <Appbar.Content title="Add Monitor" titleStyle={styles.headerTitle} />
        <Button
          mode="contained"
          disabled={!isFormValid}
          loading={status === 'submitting'}
          onPress={handleSubmit}
          style={[styles.topCreateBtn, isFormValid && { backgroundColor: theme.colors.primary }]}
          labelStyle={{ color: isFormValid ? theme.colors.onPrimary : theme.colors.textMuted }}
        >
          Créer
        </Button>
      </Appbar.Header>

      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="labelLarge" style={[styles.sectionHeader, { color: theme.colors.primary }]}>
          Général
        </Text>

        <CustomTextField
          label="Nom du groupe"
          value={groupName}
          onChangeText={setGroupName}
          placeholder="Ex: Site principal"
          placeholderTextColor={theme.colors.textMuted}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={<Folder size={20} color={theme.colors.textMuted} />}
        />

        <CustomTextField
          label="Nom du client"
          value={name}
          onChangeText={setName}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={<Folder size={20} color={theme.colors.textMuted} />}
        />

        <CustomTextField
          label="URL"
          value={url}
          onChangeText={(text: string) => {
            setUrl(text);
            if (status === 'discovered' || status === 'crawling') {
              setStatus('idle');
              setScanInternalPages(false);
              resetDiscovery();
            }

          }}
          placeholder="https://..."
          placeholderTextColor={theme.colors.textMuted}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={
            <View style={styles.horizontalIconWrapper}>
              <LinkIcon size={20} color={theme.colors.textMuted} />
            </View>
          }
          keyboardType="url"
          autoCapitalize="none"
        />

        <CustomTextField
          label="Responsable"
          value={assignee}
          onChangeText={setAssignee}
          placeholder="Ex: John Doe"
          placeholderTextColor={theme.colors.textMuted}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={<User size={20} color={theme.colors.textMuted} />}
        />

        <CustomTextField
          label="Fréquence de vérification"
          value={frequency}
          onChangeText={(text: string) => setFrequency(text.replace(/[^0-9]/g, ''))}
          placeholder="Ex: 24 (en heures)"
          placeholderTextColor={theme.colors.textMuted}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={<Clock size={20} color={theme.colors.textMuted} />}
          keyboardType="numeric"
        />

        <CustomTextField
          label="Fréquence de notification"
          value={notificationFrequency}
          onChangeText={(text: string) => setNotificationFrequency(text.replace(/[^0-9]/g, ''))}
          placeholder="Ex: 12 (en heures)"
          placeholderTextColor={theme.colors.textMuted}
          textColor={theme.colors.onBackground}
          outlineColor={theme.colors.outline}
          activeOutlineColor={theme.colors.primary}
          backgroundColor={theme.colors.background}
          leftIcon={<Bell size={20} color={theme.colors.textMuted} />}
          keyboardType="numeric"
        />

        {/* Carte Pages */}
        <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]} elevation={1}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <AlertTriangle size={20} color={theme.colors.textMuted} style={styles.iconMargin} />
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface, fontWeight: '600' }}>
                Ajouter les urls internes
              </Text>
            </View>
            <Switch
              value={scanInternalPages}
              onValueChange={handleToggleScan}
              disabled={status === 'crawling' || status === 'submitting'}
              color={theme.colors.primary}
            />
          </View>
          <View style={[styles.cardBody, { backgroundColor: theme.colors.surfaceVariant }]}>
            {status === 'crawling' && (
              <View>
                <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 10 }}>
                  Recherche des pages internes en cours...
                </Text>
                <SkeletonLoader />
              </View>
            )}
            {status === 'discovered' && pages.length > 0 && (
              <View style={styles.pagesList}>
                <TouchableOpacity style={styles.pageRow} onPress={toggleSelectAll} activeOpacity={0.7}>
                  <Checkbox
                    status={allSelected ? 'checked' : someSelected ? 'indeterminate' : 'unchecked'}
                    onPress={toggleSelectAll}
                    color={theme.colors.primary}
                  />
                  <Text style={[styles.pageRowText, { color: theme.colors.onSurface, fontWeight: '600' }]}>
                    Tout sélectionner ({selectedUrls.size}/{pages.length})
                  </Text>
                </TouchableOpacity>
                <View style={[styles.pagesDivider, { backgroundColor: theme.colors.outline }]} />
                {pages.map((page) => (
                  <TouchableOpacity key={page.url} style={styles.pageRow} onPress={() => togglePage(page.url)} activeOpacity={0.7}>
                    <Checkbox
                      status={selectedUrls.has(page.url) ? 'checked' : 'unchecked'}
                      onPress={() => togglePage(page.url)}
                      color={theme.colors.primary}
                    />
                    <View style={styles.pageItemTextContainer}>
                      <Text style={styles.pageItemName}>{page.name || "Sans nom"}</Text>
                      <Text style={styles.pageItemUrl}>{page.url}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {/* 👇 NOUVEAU : message explicite quand la découverte n'a rien trouvé,
                au lieu de laisser un formulaire bloqué sans explication. */}
            {noPagesFound && (
              <View style={styles.noPagesContainer}>
                <Text style={[styles.noPagesText, { color: theme.colors.textMuted }]}>
                  Aucune page interne détectée automatiquement. La page d'accueil sera surveillée par défaut.
                </Text>
              </View>
            )}
            {status === 'idle' && <View style={styles.emptyCardBody} />}
          </View>
        </Surface>



        {error && <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  topCreateBtn: { borderRadius: 20, marginRight: 8 },
  content: { padding: 16, gap: 16 },
  sectionHeader: { fontWeight: '700', marginBottom: 4 },
  horizontalIconWrapper: { transform: [{ rotate: '-45deg' }] },
  card: { borderRadius: 16, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconMargin: { marginRight: 2 },
  cardBody: { borderRadius: 8, overflow: 'hidden' },
  emptyCardBody: { height: 60 },
  pagesList: { paddingVertical: 4 },
  pageRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2 },
  pageRowText: { flex: 1, fontSize: 13 },
  pageItemTextContainer: { flex: 1, marginLeft: 8, paddingVertical: 6 },
  pageItemName: { fontSize: 14, fontWeight: '600', color: theme.colors.onSurface, marginBottom: 2 },
  pageItemUrl: { fontSize: 13, color: theme.colors.textMuted },
  pagesDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4, marginHorizontal: 8, opacity: 0.5 },
  errorText: { fontSize: 13, marginTop: -4 },
  noPagesContainer: { padding: 14 },
  noPagesText: { fontSize: 13, lineHeight: 18 },
  skeletonContainer: { padding: 14, gap: 12 },
  skeletonItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonCheckbox: { width: 18, height: 18, borderRadius: 4, backgroundColor: theme.colors.skeleton, position: 'relative' },
  skeletonLine: { flex: 1, height: 14, borderRadius: 4, backgroundColor: theme.colors.skeleton, position: 'relative' },
  skeletonWave: { position: 'absolute', top: 0, bottom: 0, width: '30%', backgroundColor: theme.colors.skeletonHighlight, opacity: 0.5 },
});