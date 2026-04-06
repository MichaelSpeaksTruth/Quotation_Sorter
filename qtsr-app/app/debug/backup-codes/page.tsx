'use client';

import { useState, useEffect } from 'react';
import { getSecuritySettings } from '@/lib/securityService';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export default function BackupCodeDebugPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [filteredValue, setFilteredValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [useBackup, setUseBackup] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        try {
          const settings = await getSecuritySettings(user.uid);
          if (settings?.backupCodes) {
            console.log('Backup codes from DB:', settings.backupCodes);
            setBackupCodes(settings.backupCodes);
          }
        } catch (err: any) {
          setError(`Error loading codes: ${err.message}`);
        }
      } else {
        setError('Not authenticated');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let inputValue = e.target.value;
    const originalValue = inputValue;
    
    if (useBackup) {
      inputValue = inputValue.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    } else {
      inputValue = inputValue.replace(/\D/g, '');
    }
    
    setInputValue(originalValue);
    setFilteredValue(inputValue);
    
    console.log(`Input: "${originalValue}" → Filtered: "${inputValue}" (useBackup: ${useBackup})`);
  };

  const testCodeMatch = () => {
    const normalizedInput = filteredValue.toUpperCase().replace(/\s/g, '');
    const matches = backupCodes.filter(
      (c) => c.toUpperCase().replace(/\s/g, '') === normalizedInput
    );
    
    console.log(`Testing "${filteredValue}" (normalized: "${normalizedInput}")`);
    console.log(`Backup codes in database:`, backupCodes);
    console.log(`Match result:`, matches.length > 0 ? `MATCH FOUND` : `NO MATCH`);
    
    alert(matches.length > 0 ? `✅ Code matched!` : `❌ No match found`);
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Backup Code Debug Tool</h1>
      
      {error && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Current Backup Codes */}
      <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Your Backup Codes</h2>
        {backupCodes.length === 0 ? (
          <p className="text-gray-600">No backup codes found. Enable 2FA first.</p>
        ) : (
          <div className="space-y-2">
            {backupCodes.map((code, idx) => (
              <div key={idx} className="font-mono bg-white p-2 rounded border border-blue-200">
                {idx + 1}. <span className="font-bold">{code}</span> (length: {code.length})
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Test Input */}
      <div className="bg-gray-50 border-2 border-gray-300 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Test Input Filter</h2>
        
        <div className="mb-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={useBackup}
              onChange={(e) => setUseBackup(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-semibold">
              {useBackup ? 'Backup Code Mode' : 'Authenticator Mode'}
            </span>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Original Input:</label>
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder={useBackup ? 'Try entering ABC123' : 'Try entering 123456'}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Filtered Value:</label>
          <div className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg bg-white font-mono">
            {filteredValue || '(empty)'}
          </div>
        </div>

        <div className="text-sm text-gray-600 mb-4">
          <p><strong>Filter being applied:</strong></p>
          <p>{useBackup ? 'Remove non-alphanumeric, convert to uppercase' : 'Remove non-digits'}</p>
        </div>
      </div>

      {/* Code Matching Test */}
      <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
        <h2 className="text-xl font-bold mb-4">Test Code Matching</h2>
        <p className="text-gray-600 mb-4">
          Enter one of your backup codes above, then click "Test Match" to see if it's found in your database codes.
        </p>
        <button
          onClick={testCodeMatch}
          disabled={!filteredValue}
          className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:bg-gray-300"
        >
          Test Match
        </button>
      </div>

      {/* Console Output Instructions */}
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6 mt-6">
        <h3 className="font-bold text-yellow-900 mb-2">💡 Tips:</h3>
        <ul className="list-disc list-inside text-sm text-yellow-800 space-y-1">
          <li>Open DevTools console (F12) to see detailed logs</li>
          <li>Try typing your actual backup codes in the input field</li>
          <li>Watch the "Filtered Value" to verify filtering is working</li>
          <li>Click "Test Match" to check if the code exists in your database</li>
        </ul>
      </div>
    </div>
  );
}
