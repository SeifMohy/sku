'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { BanknotesIcon, BuildingLibraryIcon, DocumentTextIcon, ArrowTrendingUpIcon, CreditCardIcon, ChartBarIcon, PencilIcon } from '@heroicons/react/24/outline'
import { clsx } from 'clsx'
import { isFacilityAccount, getFacilityDisplayType, isRegularAccount } from '@/utils/bankStatementUtils'
import { useSearchParams } from 'next/navigation'
import { formatCurrencyByCode } from '@/lib/format'
import { currencyCache } from '@/lib/services/currencyCache'
import { useAuth } from '@/contexts/auth-context'

// Define types based on Prisma schema
type Transaction = {
    id: number;
    transactionDate: string;
    creditAmount: string | null;
    debitAmount: string | null;
    description: string | null;
    balance: string | null;
    pageNumber: string | null;
    entityName: string | null;
}

type BankStatement = {
    id: number;
    bankName: string;
    accountNumber: string;
    accountType: string | null;
    accountCurrency: string | null;
    statementPeriodStart: string;
    statementPeriodEnd: string;
    startingBalance: string;
    endingBalance: string;
    tenor: string | null;
    availableLimit: string | null;
    interestRate: string | null;
    transactions: Transaction[];
}

type Bank = {
    id: number;
    name: string;
    createdAt: string;
    updatedAt: string;
    bankStatements: BankStatement[];
}

// Display types for processed data
type AccountDisplay = {
    id: number;
    accountNumber: string;
    balance: string;
    type: string;
    currency: string;
    interestRate: string;
    lastUpdate: string;
}

type FacilityDisplay = {
    id: number;
    facilityType: string;
    limit: string;
    used: string;
    available: string;
    interestRate: string;
    tenor: string;
    statementId: number;
}

type TransactionDisplay = {
    id: number;
    date: string;
    account: string;
    description: string;
    amount: string;
    type: 'credit' | 'debit';
}

// Edit facility modal types
type EditFacilityData = {
    tenor: string;
    availableLimit: string;
    interestRate: string;
}

export default function BankProfile({ params }: { params: { id: string } }) {
    const searchParams = useSearchParams()
    const [bank, setBank] = useState<Bank | null>(null)
    const [activeTab, setActiveTab] = useState('overview')
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const { session } = useAuth()
    
    // Converted financial metrics in EGP
    const [financialMetricsEGP, setFinancialMetricsEGP] = useState({ 
        totalCashBalance: 0, 
        currentOutstanding: 0 
    })
    const [cashFlowDataEGP, setCashFlowDataEGP] = useState({ 
        labels: [] as string[], 
        inflows: [] as number[], 
        outflows: [] as number[] 
    })
    
    // Edit facility state
    const [editingFacility, setEditingFacility] = useState<number | null>(null)
    const [editFacilityData, setEditFacilityData] = useState<EditFacilityData>({
        tenor: '',
        availableLimit: '',
        interestRate: ''
    })
    const [isSaving, setIsSaving] = useState(false)

    // Set initial tab based on URL parameter
    useEffect(() => {
        const tab = searchParams.get('tab')
        if (tab && ['overview', 'accounts', 'facilities', 'transactions'].includes(tab)) {
            setActiveTab(tab)
        }
    }, [searchParams])

    // Load bank data
    useEffect(() => {
        const fetchBankData = async () => {
            try {
                console.log('Starting fetch for bank ID:', params.id)
                setIsLoading(true)
                setError(null)

                // Check if user is authenticated
                if (!session?.access_token) {
                    console.log('❌ No session or access token available')
                    setError('Authentication required')
                    setIsLoading(false)
                    return
                }

                const response = await fetch(`/api/banks/${params.id}`, {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                })
                console.log('Fetch response status:', response.status, response.ok)
                
                const data = await response.json()
                console.log('Fetch response data:', data)

                if (data.success && data.bank) {
                    console.log('Setting bank data:', data.bank.name)
                    setBank(data.bank)
                } else {
                    console.error('API returned error:', data.error)
                    setError(data.error || 'Failed to load bank data')
                }
            } catch (error) {
                console.error('Fetch error:', error)
                setError('Failed to load bank data')
            } finally {
                console.log('Setting loading to false')
                setIsLoading(false)
            }
        }

        fetchBankData()
    }, [params.id, session])

    // Helper function to convert amount to EGP
    const convertToEGP = useCallback(async (amount: number, fromCurrency: string): Promise<number> => {
        if (fromCurrency === 'EGP' || !fromCurrency) {
            return amount
        }
        
        try {
            const conversion = await currencyCache.convertCurrency(amount, fromCurrency, 'EGP')
            return conversion.convertedAmount
        } catch (error) {
            console.warn(`Failed to convert ${amount} ${fromCurrency} to EGP:`, error)
            return amount // Return original amount if conversion fails
        }
    }, [])

    // Calculate financial metrics in EGP
    const calculateFinancialMetricsEGP = useCallback(async () => {
        if (!bank) return
        
        let totalCashBalanceEGP = 0
        let currentOutstandingEGP = 0
        
        // Group statements by account number to get latest statement for each account
        const accountGroups = bank.bankStatements.reduce((groups: { [key: string]: BankStatement[] }, statement) => {
            const accountNumber = statement.accountNumber
            if (!groups[accountNumber]) {
                groups[accountNumber] = []
            }
            groups[accountNumber].push(statement)
            return groups
        }, {})
        
        // Process latest statement for each unique account
        for (const statements of Object.values(accountGroups)) {
            const latestStatement = statements.reduce((latest, current) => {
                return new Date(current.statementPeriodEnd) > new Date(latest.statementPeriodEnd) 
                    ? current 
                    : latest
            })
            
            const balance = parseFloat(latestStatement.endingBalance)
            
            if (isRegularAccount(latestStatement.accountType, balance)) {
                // Convert regular accounts to EGP
                const balanceEGP = await convertToEGP(
                    balance, 
                    latestStatement.accountCurrency || 'USD'
                )
                totalCashBalanceEGP += balanceEGP
            } else if (isFacilityAccount(latestStatement.accountType, balance)) {
                // Convert facilities to EGP
                const outstandingEGP = await convertToEGP(
                    Math.abs(balance), 
                    latestStatement.accountCurrency || 'USD'
                )
                currentOutstandingEGP += outstandingEGP
            }
        }
        
        setFinancialMetricsEGP({
            totalCashBalance: totalCashBalanceEGP,
            currentOutstanding: currentOutstandingEGP
        })
    }, [bank, convertToEGP])

    // Calculate cash flow data in EGP
    const calculateCashFlowDataEGP = useCallback(async () => {
        if (!bank) return
        
        // Collect all transactions from all statements
        const allTransactions = bank.bankStatements.flatMap(statement =>
            statement.transactions.map(transaction => ({
                ...transaction,
                accountCurrency: statement.accountCurrency || 'USD'
            }))
        )

        // Group transactions by month
        const monthlyData: { [key: string]: { inflows: number, outflows: number } } = {}
        
        for (const transaction of allTransactions) {
            const date = new Date(transaction.transactionDate)
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { inflows: 0, outflows: 0 }
            }
            
            const creditAmount = parseFloat(transaction.creditAmount || '0')
            const debitAmount = parseFloat(transaction.debitAmount || '0')
            
            if (creditAmount > 0) {
                const creditEGP = await convertToEGP(creditAmount, transaction.accountCurrency)
                monthlyData[monthKey].inflows += creditEGP
            }
            if (debitAmount > 0) {
                const debitEGP = await convertToEGP(debitAmount, transaction.accountCurrency)
                monthlyData[monthKey].outflows += debitEGP
            }
        }

        // Sort months and prepare chart data
        const sortedMonths = Object.keys(monthlyData).sort()
        const labels = sortedMonths.map(month => {
            const [year, monthNum] = month.split('-')
            const date = new Date(parseInt(year), parseInt(monthNum) - 1)
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        })
        
        const inflows = sortedMonths.map(month => monthlyData[month].inflows)
        const outflows = sortedMonths.map(month => monthlyData[month].outflows)
        
        setCashFlowDataEGP({ labels, inflows, outflows })
    }, [bank, convertToEGP])

    // Calculate EGP metrics when bank data changes
    useEffect(() => {
        if (bank) {
            calculateFinancialMetricsEGP()
            calculateCashFlowDataEGP()
        }
    }, [bank, calculateFinancialMetricsEGP, calculateCashFlowDataEGP])

    // Helper function to format currency - always displays in EGP for consistency
    const formatCurrency = (amount: number | string): string => {
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
        return formatCurrencyByCode(numAmount, 'EGP')
    }

    // Helper function to format currency with original currency (for individual account display)
    const formatCurrencyOriginal = (amount: number | string, currency?: string): string => {
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
        const currencyCode = currency || 'USD'
        return formatCurrencyByCode(numAmount, currencyCode)
    }

    // Helper function to format date
    const formatDate = (dateString: string): string => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })
    }

    // Helper function to format interest rate
    const formatInterestRate = (rate: string | null): string => {
        if (!rate || rate.trim() === '') return 'N/A';
        const cleanRate = rate.trim();
        // Only add % if it doesn't already contain % or other symbols
        if (cleanRate.includes('%') || cleanRate.includes('+') || cleanRate.toLowerCase().includes('prime') || cleanRate.toLowerCase().includes('libor') || cleanRate.toLowerCase().includes('variable')) {
            return cleanRate;
        }
        // If it's just a number, add %
        if (!isNaN(parseFloat(cleanRate))) {
            return `${cleanRate}%`;
        }
        return cleanRate;
    }

    // Helper function to format tenor
    const formatTenor = (tenor: string | null): string => {
        if (!tenor || tenor.trim() === '') return 'N/A';
        const cleanTenor = tenor.trim();
        // Only add 'days' if it doesn't already contain time units
        if (cleanTenor.toLowerCase().includes('day') || 
            cleanTenor.toLowerCase().includes('month') || 
            cleanTenor.toLowerCase().includes('year') || 
            cleanTenor.toLowerCase().includes('week') ||
            cleanTenor.toLowerCase().includes('revolving')) {
            return cleanTenor;
        }
        // If it's just a number, add 'days'
        if (!isNaN(parseFloat(cleanTenor))) {
            return `${cleanTenor} days`;
        }
        return cleanTenor;
    }

    // Process bank statements into accounts display format (POSITIVE and ZERO balances)
    const processAccountsData = (): AccountDisplay[] => {
        if (!bank) return []
        
        // First filter for regular accounts
        const regularStatements = bank.bankStatements
            .filter(statement => isRegularAccount(statement.accountType, parseFloat(statement.endingBalance)))
        
        // Group by account number and get the latest statement for each account
        const accountGroups = regularStatements.reduce((groups: { [key: string]: BankStatement[] }, statement) => {
            const accountNumber = statement.accountNumber
            if (!groups[accountNumber]) {
                groups[accountNumber] = []
            }
            groups[accountNumber].push(statement)
            return groups
        }, {})
        
        // For each account, get the statement with the latest end date
        return Object.entries(accountGroups).map(([accountNumber, statements]) => {
            const latestStatement = statements.reduce((latest, current) => {
                return new Date(current.statementPeriodEnd) > new Date(latest.statementPeriodEnd) 
                    ? current 
                    : latest
            })
            
            return {
                id: latestStatement.id,
                accountNumber: latestStatement.accountNumber,
                balance: formatCurrencyOriginal(parseFloat(latestStatement.endingBalance), latestStatement.accountCurrency || undefined),
                type: latestStatement.accountType || 'Current Account',
                currency: latestStatement.accountCurrency || 'USD',
                interestRate: 'N/A',
                lastUpdate: `${formatDate(latestStatement.statementPeriodStart)} - ${formatDate(latestStatement.statementPeriodEnd)}`
            }
        })
    }

    // Process bank statements into facilities display format (using new facility logic)
    const processFacilitiesData = (): FacilityDisplay[] => {
        if (!bank) return []
        
        // First filter for facility accounts
        const facilityStatements = bank.bankStatements
            .filter(statement => isFacilityAccount(statement.accountType, parseFloat(statement.endingBalance)))
        
        // Group by account number and get the latest statement for each facility
        const facilityGroups = facilityStatements.reduce((groups: { [key: string]: BankStatement[] }, statement) => {
            const accountNumber = statement.accountNumber
            if (!groups[accountNumber]) {
                groups[accountNumber] = []
            }
            groups[accountNumber].push(statement)
            return groups
        }, {})
        
        // For each facility account, get the statement with the latest end date
        return Object.entries(facilityGroups).map(([accountNumber, statements]) => {
            const latestStatement = statements.reduce((latest, current) => {
                return new Date(current.statementPeriodEnd) > new Date(latest.statementPeriodEnd) 
                    ? current 
                    : latest
            })
            
            return {
                id: latestStatement.id,
                facilityType: getFacilityDisplayType(latestStatement.accountType, parseFloat(latestStatement.endingBalance)),
                limit: latestStatement.availableLimit ? formatCurrencyOriginal(parseFloat(latestStatement.availableLimit), latestStatement.accountCurrency || undefined) : 'N/A',
                used: formatCurrencyOriginal(Math.abs(parseFloat(latestStatement.endingBalance)), latestStatement.accountCurrency || undefined),
                available: latestStatement.availableLimit 
                    ? formatCurrencyOriginal(parseFloat(latestStatement.availableLimit) - Math.abs(parseFloat(latestStatement.endingBalance)), latestStatement.accountCurrency || undefined)
                    : 'N/A',
                interestRate: formatInterestRate(latestStatement.interestRate),
                tenor: formatTenor(latestStatement.tenor),
                statementId: latestStatement.id
            }
        })
    }

    // Process transactions for display (latest 10)
    const processTransactionsData = (): TransactionDisplay[] => {
        if (!bank) return []
        
        // Flatten all transactions from all statements
        const allTransactions = bank.bankStatements.flatMap(statement =>
            statement.transactions.map(transaction => ({
                id: transaction.id,
                date: formatDate(transaction.transactionDate),
                account: statement.accountNumber,
                description: transaction.description || 'No description',
                amount: transaction.creditAmount 
                    ? formatCurrencyOriginal(parseFloat(transaction.creditAmount), statement.accountCurrency || undefined)
                    : formatCurrencyOriginal(parseFloat(transaction.debitAmount || '0'), statement.accountCurrency || undefined),
                type: (transaction.creditAmount && parseFloat(transaction.creditAmount) > 0) ? 'credit' as const : 'debit' as const
            }))
        )

        // Sort by date (newest first) and take top 10
        return allTransactions
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10)
    }

    // Process transactions for cash flow chart
    const processCashFlowData = () => {
        if (!bank) return { labels: [], inflows: [], outflows: [] }
        
        // Collect all transactions from all statements
        const allTransactions = bank.bankStatements.flatMap(statement =>
            statement.transactions.map(transaction => ({
                ...transaction,
                accountCurrency: statement.accountCurrency || 'USD'
            }))
        )

        // Group transactions by month
        const monthlyData: { [key: string]: { inflows: number, outflows: number } } = {}
        
        allTransactions.forEach(transaction => {
            const date = new Date(transaction.transactionDate)
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { inflows: 0, outflows: 0 }
            }
            
            const creditAmount = parseFloat(transaction.creditAmount || '0')
            const debitAmount = parseFloat(transaction.debitAmount || '0')
            
            if (creditAmount > 0) {
                monthlyData[monthKey].inflows += creditAmount
            }
            if (debitAmount > 0) {
                monthlyData[monthKey].outflows += debitAmount
            }
        })

        // Sort months and prepare chart data
        const sortedMonths = Object.keys(monthlyData).sort()
        const labels = sortedMonths.map(month => {
            const [year, monthNum] = month.split('-')
            const date = new Date(parseInt(year), parseInt(monthNum) - 1)
            return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        })
        
        const inflows = sortedMonths.map(month => monthlyData[month].inflows)
        const outflows = sortedMonths.map(month => monthlyData[month].outflows)
        
        return { labels, inflows, outflows }
    }

    // Handle facility edit
    const handleEditFacility = (facility: FacilityDisplay) => {
        const statement = bank?.bankStatements.find(s => s.id === facility.statementId);
        if (statement) {
            setEditFacilityData({
                tenor: statement.tenor || '',
                availableLimit: statement.availableLimit || '',
                interestRate: statement.interestRate || ''
            });
            setEditingFacility(facility.statementId);
        }
    };

    const handleSaveFacility = async () => {
        if (!editingFacility) return;
        
        // Check if user is authenticated
        if (!session?.access_token) {
            console.log('❌ No session or access token available')
            alert('Authentication required')
            return
        }
        
        setIsSaving(true);
        try {
            const response = await fetch(`/api/annotation/statements/${editingFacility}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tenor: editFacilityData.tenor || null,
                    availableLimit: editFacilityData.availableLimit ? parseFloat(editFacilityData.availableLimit) : null,
                    interestRate: editFacilityData.interestRate || null
                })
            });
            
            if (response.ok) {
                // Refresh bank data
                const bankResponse = await fetch(`/api/banks/${params.id}`, {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`,
                        'Content-Type': 'application/json',
                    },
                });
                const bankData = await bankResponse.json();
                if (bankData.success) {
                    setBank(bankData.bank);
                }
                setEditingFacility(null);
            } else {
                const errorData = await response.json();
                alert(`Error updating facility: ${errorData.error}`);
            }
        } catch (error) {
            console.error('Error updating facility:', error);
            alert('Error updating facility');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setEditingFacility(null);
        setEditFacilityData({
            tenor: '',
            availableLimit: '',
            interestRate: ''
        });
    };

    // If still loading, show a loading state
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading bank data...</p>
                </div>
            </div>
        )
    }

    // If there's an error or no data, show error state
    if (error || !bank) {
        return (
            <div className="text-center p-6 bg-red-50 rounded-lg">
                <p className="text-red-700">{error || "Bank not found"}</p>
                <Link href="/dashboard/banks" className="mt-4 inline-block text-blue-600 hover:underline">
                    Return to Banks Overview
                </Link>
            </div>
        )
    }

    const accounts = processAccountsData()
    const facilities = processFacilitiesData()
    const transactions = processTransactionsData()
    const cashFlowData = processCashFlowData()

    return (
        <div>
            <div className="flex items-center mb-6">
                <Link
                    href="/dashboard/banks"
                    className="mr-4 inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
                >
                    <ArrowLeftIcon className="h-4 w-4 mr-1" />
                    Back to Banks
                </Link>
                <h1 className="text-2xl font-semibold text-gray-900">{bank.name}</h1>
            </div>

            {/* Bank Summary Card */}
            <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
                <div className="p-6 flex items-start">
                    <div className="flex-shrink-0 h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center">
                        <BuildingLibraryIcon className="h-10 w-10 text-blue-600" aria-hidden="true" />
                    </div>
                    <div className="ml-6">
                        <h2 className="text-xl font-medium text-gray-900">{bank.name}</h2>
                        <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                            <div>
                                <dt className="text-gray-500">Total Accounts</dt>
                                <dd className="font-medium text-gray-900">{accounts.length}</dd>
                            </div>
                            <div>
                                <dt className="text-gray-500">Credit Facilities</dt>
                                <dd className="font-medium text-gray-900">{facilities.length}</dd>
                            </div>
                            <div>
                                <dt className="text-gray-500">Bank Statements</dt>
                                <dd className="font-medium text-gray-900">{bank.bankStatements.length}</dd>
                            </div>
                            <div>
                                <dt className="text-gray-500">Total Transactions</dt>
                                <dd className="font-medium text-gray-900">
                                    {bank.bankStatements.reduce((sum, statement) => sum + statement.transactions.length, 0)}
                                </dd>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={clsx(
                            activeTab === 'overview'
                                ? 'border-[#595CFF] text-[#595CFF]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                            'whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm'
                        )}
                    >
                        Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('accounts')}
                        className={clsx(
                            activeTab === 'accounts'
                                ? 'border-[#595CFF] text-[#595CFF]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                            'whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm'
                        )}
                    >
                        Accounts ({accounts.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('facilities')}
                        className={clsx(
                            activeTab === 'facilities'
                                ? 'border-[#595CFF] text-[#595CFF]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                            'whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm'
                        )}
                    >
                        Facilities ({facilities.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('transactions')}
                        className={clsx(
                            activeTab === 'transactions'
                                ? 'border-[#595CFF] text-[#595CFF]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                            'whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm'
                        )}
                    >
                        Transactions
                    </button>
                </nav>
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
                <div>
                    {/* Financial Metrics */}
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-6">
                        <div className="bg-white overflow-hidden shadow rounded-lg">
                            <div className="p-5">
                                <div className="flex items-center">
                                    <div className="flex-shrink-0">
                                        <BanknotesIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <div className="ml-5 w-0 flex-1">
                                        <dl>
                                            <dt className="truncate text-sm font-medium text-gray-500">Current Cash Balance</dt>
                                            <dd>
                                                <div className="text-lg font-medium text-gray-900">{formatCurrency(financialMetricsEGP.totalCashBalance)}</div>
                                            </dd>
                                        </dl>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white overflow-hidden shadow rounded-lg">
                            <div className="p-5">
                                <div className="flex items-center">
                                    <div className="flex-shrink-0">
                                        <DocumentTextIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <div className="ml-5 w-0 flex-1">
                                        <dl>
                                            <dt className="truncate text-sm font-medium text-gray-500">Total Credit Limit</dt>
                                            <dd>
                                                <div className="text-lg font-medium text-gray-900">N/A</div>
                                            </dd>
                                        </dl>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white overflow-hidden shadow rounded-lg">
                            <div className="p-5">
                                <div className="flex items-center">
                                    <div className="flex-shrink-0">
                                        <ArrowTrendingUpIcon className="h-6 w-6 text-gray-400" aria-hidden="true" />
                                    </div>
                                    <div className="ml-5 w-0 flex-1">
                                        <dl>
                                            <dt className="truncate text-sm font-medium text-gray-500">Current Outstanding</dt>
                                            <dd>
                                                <div className="text-lg font-medium text-gray-900">{formatCurrency(financialMetricsEGP.currentOutstanding)}</div>
                                            </dd>
                                        </dl>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Cash Flow Chart */}
                    <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
                        <div className="px-6 py-5 border-b border-gray-200">
                            <h3 className="text-lg font-medium leading-6 text-gray-900">Cash Flow - {bank.name}</h3>
                        </div>
                        <div className="p-6">
                            {cashFlowDataEGP.labels.length > 0 ? (
                                <div className="space-y-6">
                                    {/* Chart Legend */}
                                    <div className="flex items-center justify-center space-x-6 text-sm">
                                        <div className="flex items-center">
                                            <div className="w-3 h-3 bg-green-500 rounded mr-2"></div>
                                            <span>Inflows</span>
                                        </div>
                                        <div className="flex items-center">
                                            <div className="w-3 h-3 bg-red-500 rounded mr-2"></div>
                                            <span>Outflows</span>
                                        </div>
                                    </div>
                                    
                                    {/* Bar Chart */}
                                    <div className="relative">
                                        {/* Calculate max value for scaling */}
                                        {(() => {
                                            const maxValue = Math.max(
                                                ...cashFlowDataEGP.inflows,
                                                ...cashFlowDataEGP.outflows,
                                                1 // Minimum value to avoid division by zero
                                            );
                                            const chartHeight = 300; // Fixed chart height in pixels
                                            
                                            return (
                                                <div className="relative">
                                                    {/* Y-axis labels */}
                                                    <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-gray-500 pr-2" style={{ width: '60px' }}>
                                                        <span>{formatCurrency(maxValue)}</span>
                                                        <span>{formatCurrency(maxValue * 0.75)}</span>
                                                        <span>{formatCurrency(maxValue * 0.5)}</span>
                                                        <span>{formatCurrency(maxValue * 0.25)}</span>
                                                        <span>EGP 0</span>
                                                    </div>
                                                    
                                                    {/* Chart area */}
                                                    <div className="ml-16">
                                                        {/* Grid lines */}
                                                        <div className="relative" style={{ height: `${chartHeight}px` }}>
                                                            {[0, 0.25, 0.5, 0.75, 1].map((ratio, index) => (
                                                                <div
                                                                    key={index}
                                                                    className="absolute w-full border-t border-gray-200"
                                                                    style={{ top: `${ratio * 100}%` }}
                                                                />
                                                            ))}
                                                            
                                                            {/* Bars */}
                                                            <div className="absolute inset-0 flex items-end justify-between px-2">
                                                                {cashFlowDataEGP.labels.map((label, index) => {
                                                                    const inflow = cashFlowDataEGP.inflows[index];
                                                                    const outflow = cashFlowDataEGP.outflows[index];
                                                                    const inflowHeight = (inflow / maxValue) * chartHeight;
                                                                    const outflowHeight = (outflow / maxValue) * chartHeight;
                                                                    const barWidth = Math.max(40, (100 / cashFlowDataEGP.labels.length) - 10); // Responsive bar width
                                                                    
                                                                    return (
                                                                        <div key={index} className="flex flex-col items-center" style={{ width: `${barWidth}px` }}>
                                                                            {/* Bars container */}
                                                                            <div className="flex items-end space-x-1 mb-2" style={{ height: `${chartHeight}px` }}>
                                                                                {/* Inflow bar */}
                                                                                <div className="relative group">
                                                                                    <div
                                                                                        className="bg-green-500 rounded-t transition-all duration-200 hover:bg-green-600"
                                                                                        style={{
                                                                                            width: `${barWidth / 2 - 2}px`,
                                                                                            height: `${inflowHeight}px`,
                                                                                            minHeight: inflow > 0 ? '2px' : '0px'
                                                                                        }}
                                                                                    />
                                                                                    {/* Tooltip for inflow */}
                                                                                    {inflow > 0 && (
                                                                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                                                                            Inflow: {formatCurrency(inflow)}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                                
                                                                                {/* Outflow bar */}
                                                                                <div className="relative group">
                                                                                    <div
                                                                                        className="bg-red-500 rounded-t transition-all duration-200 hover:bg-red-600"
                                                                                        style={{
                                                                                            width: `${barWidth / 2 - 2}px`,
                                                                                            height: `${outflowHeight}px`,
                                                                                            minHeight: outflow > 0 ? '2px' : '0px'
                                                                                        }}
                                                                                    />
                                                                                    {/* Tooltip for outflow */}
                                                                                    {outflow > 0 && (
                                                                                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                                                                            Outflow: {formatCurrency(outflow)}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            
                                                                            {/* X-axis label */}
                                                                            <div className="text-xs text-gray-600 text-center transform -rotate-45 origin-center mt-2">
                                                                                {label}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                        
                                                        {/* X-axis line */}
                                                        <div className="border-t border-gray-300 mt-8"></div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                    
                                    {/* Summary */}
                                    <div className="mt-6 pt-4 border-t border-gray-200">
                                        <div className="grid grid-cols-3 gap-4 text-center">
                                            <div>
                                                <p className="text-sm text-gray-500">Total Inflows</p>
                                                <p className="text-lg font-semibold text-green-600">
                                                    {formatCurrency(cashFlowDataEGP.inflows.reduce((sum, val) => sum + val, 0))}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">Total Outflows</p>
                                                <p className="text-lg font-semibold text-red-600">
                                                    {formatCurrency(cashFlowDataEGP.outflows.reduce((sum, val) => sum + val, 0))}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm text-gray-500">Net Cash Flow</p>
                                                <p className={`text-lg font-semibold ${
                                                    (cashFlowDataEGP.inflows.reduce((sum, val) => sum + val, 0) - 
                                                     cashFlowDataEGP.outflows.reduce((sum, val) => sum + val, 0)) >= 0 
                                                        ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                    {formatCurrency(
                                                        cashFlowDataEGP.inflows.reduce((sum, val) => sum + val, 0) - 
                                                        cashFlowDataEGP.outflows.reduce((sum, val) => sum + val, 0)
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
                                    <div className="text-center">
                                        <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                        <p className="text-gray-500">No transaction data available for cash flow analysis</p>
                                        <p className="text-sm text-gray-400 mt-2">
                                            Upload bank statements to see cash flow trends
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Accounts Tab */}
            {activeTab === 'accounts' && (
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h3 className="text-lg font-medium leading-6 text-gray-900">Bank Accounts</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            Regular bank accounts from {bank.name} (Checking, Savings, Business accounts, etc. - excluding credit facilities)
                        </p>
                    </div>
                    {accounts.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Account Number
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Type
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Currency
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Balance
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Interest Rate
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Statement Period
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {accounts.map((account) => (
                                        <tr key={account.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {account.accountNumber}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {account.type}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {account.currency}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                                                {account.balance}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {account.interestRate}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {account.lastUpdate}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-6 py-4 text-center text-sm text-gray-500">
                            No regular bank accounts found for this bank.
                        </div>
                    )}
                </div>
            )}

            {/* Facilities Tab */}
            {activeTab === 'facilities' && (
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h3 className="text-lg font-medium leading-6 text-gray-900">Credit Facilities</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            Credit facilities and overdraft accounts from {bank.name} (determined by account type: Overdraft, Short-term Loans, Long-term Loans, etc.)
                        </p>
                    </div>
                    {facilities.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Facility Type
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Amount Used
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Available Limit
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Interest Rate
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Tenor
                                        </th>
                                        <th scope="col" className="relative px-6 py-3">
                                            <span className="sr-only">Edit</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {facilities.map((facility) => (
                                        <tr key={facility.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {facility.facilityType}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {facility.used}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {editingFacility === facility.statementId ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={editFacilityData.availableLimit}
                                                        onChange={(e) => setEditFacilityData(prev => ({ ...prev, availableLimit: e.target.value }))}
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        placeholder="Available limit"
                                                    />
                                                ) : (
                                                    facility.available
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {editingFacility === facility.statementId ? (
                                                    <input
                                                        type="text"
                                                        value={editFacilityData.interestRate}
                                                        onChange={(e) => setEditFacilityData(prev => ({ ...prev, interestRate: e.target.value }))}
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        placeholder="e.g., 5.25% or Prime + 2%"
                                                    />
                                                ) : (
                                                    facility.interestRate
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {editingFacility === facility.statementId ? (
                                                    <input
                                                        type="text"
                                                        value={editFacilityData.tenor}
                                                        onChange={(e) => setEditFacilityData(prev => ({ ...prev, tenor: e.target.value }))}
                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                        placeholder="e.g., 12 months, 2 years"
                                                    />
                                                ) : (
                                                    facility.tenor
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                {editingFacility === facility.statementId ? (
                                                    <div className="flex space-x-2">
                                                        <button
                                                            onClick={handleSaveFacility}
                                                            disabled={isSaving}
                                                            className="text-green-600 hover:text-green-900 disabled:opacity-50"
                                                        >
                                                            {isSaving ? 'Saving...' : 'Save'}
                                                        </button>
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            disabled={isSaving}
                                                            className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEditFacility(facility)}
                                                        className="text-indigo-600 hover:text-indigo-900"
                                                    >
                                                        <PencilIcon className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-6 py-4 text-center text-sm text-gray-500">
                            No credit facilities found for this bank.
                        </div>
                    )}
                </div>
            )}

            {/* Transactions Tab */}
            {activeTab === 'transactions' && (
                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="px-6 py-5 border-b border-gray-200">
                        <h3 className="text-lg font-medium leading-6 text-gray-900">Recent Transactions</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            Latest transactions from all accounts at {bank.name}
                        </p>
                    </div>
                    {transactions.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Date
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Account
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Description
                                        </th>
                                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Amount
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {transactions.map((transaction) => (
                                        <tr key={transaction.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {transaction.date}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {transaction.account}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-900">
                                                {transaction.description}
                                            </td>
                                            <td className={clsx(
                                                "px-6 py-4 whitespace-nowrap text-sm font-medium text-right",
                                                transaction.type === 'credit' ? 'text-green-600' : 'text-red-600'
                                            )}>
                                                {transaction.type === 'credit' ? '+' : '-'} {transaction.amount}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="px-6 py-4 text-center text-sm text-gray-500">
                            No transactions found for this bank.
                        </div>
                    )}

                    {/* Transaction Summary */}
                    {transactions.length > 0 && (
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                            <h4 className="text-sm font-medium text-gray-900">Transaction Summary (Showing latest {transactions.length})</h4>
                            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <div className="bg-white p-3 rounded shadow-sm">
                                    <p className="text-xs text-gray-500">Total Credits</p>
                                    <p className="text-lg font-medium text-green-600">
                                        {formatCurrency(
                                            transactions
                                                .filter(t => t.type === 'credit')
                                                .reduce((sum, t) => sum + parseFloat(t.amount.replace(/[^0-9.-]+/g, '')), 0)
                                        )}
                                    </p>
                                </div>
                                <div className="bg-white p-3 rounded shadow-sm">
                                    <p className="text-xs text-gray-500">Total Debits</p>
                                    <p className="text-lg font-medium text-red-600">
                                        {formatCurrency(
                                            transactions
                                                .filter(t => t.type === 'debit')
                                                .reduce((sum, t) => sum + parseFloat(t.amount.replace(/[^0-9.-]+/g, '')), 0)
                                        )}
                                    </p>
                                </div>
                                <div className="bg-white p-3 rounded shadow-sm">
                                    <p className="text-xs text-gray-500">Net Flow</p>
                                    <p className="text-lg font-medium text-gray-900">
                                        {formatCurrency(
                                            transactions
                                                .filter(t => t.type === 'credit')
                                                .reduce((sum, t) => sum + parseFloat(t.amount.replace(/[^0-9.-]+/g, '')), 0) -
                                            transactions
                                                .filter(t => t.type === 'debit')
                                                .reduce((sum, t) => sum + parseFloat(t.amount.replace(/[^0-9.-]+/g, '')), 0)
                                        )}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
} 