using JetBrains.Annotations;
using Shapes;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;

public class AttackInformation
{
    public Timing cooldownTimer;

    //public int lastRoundFired = -1;
    public WeaponController weaponController;


    public bool IsSet = false;
    public int secondSlot
    {
        get
        {
            return _second;
        }
        set {
            IsSet = true;
            _second = value;
        }
    }
    private int _second = 0;
}

[Serializable]
public abstract class ShipSubsystem : MonoBehaviour
{
    public string id = Guid.NewGuid().ToString();

    public SubsystemType subsystemType;

    public virtual float HealthPercent { get; }

    public virtual string SubsystemName { get; }

    public virtual string HealthDisplayText { get; }

    public virtual HealthStats SubsystemHealth { get; }

    public ShipController ship;
    
    public virtual Transform targetLocation { get; }

    public abstract void Init();
    public abstract void Damage(float amount, FiredEvent firedEvent, bool isRaw);
    public abstract void Heal(float amount);

    public bool IsDisabled => SubsystemHealth.IsDead;

    public SmokeSystem smokeSystem;

    public Action onSubsystemHit;

}

[Serializable]
public class ShipMainSystems {
    public ThrusterSystem thrusterSystem;
}

public enum ShipMoveModes {
    FULL_STOP = 0,
    FULL_SPEED = 1,
    MOVE_AND_TURN = 2,
    TURN_SLIDE = 3
}

public class DiceRoller {
    // This should roll once per second.
    public static void RollDiceForBoardingParty(ref int crewOpposing, ref int crewDefending, int efficiency = 1) {
        if (crewOpposing == 0 || crewDefending == 0)
        {
            return;
        }

        int oppositionSuccess = Dice.Roll(crewOpposing, 6, 5);
        int defenderSuccess = Dice.Roll(crewDefending, 6, 5);
        // better odds can be achieved with more training lol.
        // crewOpposing -= defenderSuccess;
        // crewDefending -= oppositionSuccess;

        //slow down interaction lol
        if(oppositionSuccess > efficiency)
        {
            crewDefending--;
            Debug.Log($"Attackers killed {1} marines");
        }

        if(defenderSuccess > 0)
        {
            crewOpposing = crewOpposing - efficiency; // defense should have advantage, based on ship health
            Debug.Log($"Defenders killed {efficiency} marines");
        }

        // cant be less than zero.
        if(crewDefending < 0)
        {
            crewDefending = 0;
        }

        if(crewOpposing < 0)
        {
            crewOpposing = 0;
        }
    }
}

[Serializable]
public class BoardingMarines
{
    public ShipFaction faction;
    public int boardingParty = 10;

    public BoardingMarines(ShipFaction shipFaction, int boarding)
    {
        faction = shipFaction;
        boardingParty = boarding;
    }
}

public class LastMove {
    public Vector3 shipOffset;
    public Quaternion shipRotation;
    public ShipMoveModes previousShipMoveMode;

    public void SetLastMove(Vector3 offset, Quaternion rotation, ShipMoveModes shipMoveModes)
    {
        shipOffset = offset;
        shipRotation = rotation;
        previousShipMoveMode = shipMoveModes;
    }
}

public class ShipController : MonoBehaviour, ITimedSimulator
{

    public float BoardingRange = 10f;

    // the game save should override this.
    public int crewRemaining = 50;

    public int CrewMax = 200;
    public int marines = 15;
    public int MarinesMax = 50;
    public int boardingActionCapacity = 8;

    public ShipFaction shipFaction;

    public Vector3 manueverOffset;
    public Quaternion orientation;

    public float MaxThrusterRange
    {
        get
        {
            if (hasBoosted)
            {
                return maxThrusterRangeValue * 2f;
            }
            else if (initiatedFullStop)
            {
                return maxThrusterRangeValue / 2f;
            }
            else
            {
                return maxThrusterRangeValue + AIBoost;
            }
        }
    }

    public void AutoCaptureProcedure(ShipFaction shipFaction){

        marines = 0;
        IntruderBoardingAction(shipFaction, 20);
    }

    public float AIBoost = 0;

    public float maxThrusterRangeValue = 20f;

    public float maxThrustManueverRange = 20f;

    public bool hasBoosted = false;
    public ShipMoveModes shipMoveModes = ShipMoveModes.MOVE_AND_TURN; // in order to move in full acceleration mode, move mode of Move and Rotate needs to be called first.
    public bool initiatedFullStop = false;
    public LastMove lastMove = new LastMove();

    public GameObject shipMovementEstimator;
    public float zRoll = 0;

    GameManager gm;

    public List<WeaponController> weapons;

    public float impactExpDelay = 1;

    public bool SimIsRunning { get; set; }

    public SimVector3Update positionUpdate;
    public SimQuaternionUpdate rotationUpdate;

    public bool isPlayerShip = true;
    public bool isFriendly = false;


    [SerializeField]
    protected ShipController targetting;
    public ShipController Targeting { get => targetting; set => targetting = value; }

    public ShipSubsystem targettingSubsystem;

    public GameObject NavWidgetRtn;
    public GameObject NavWidgetRoll;

    public ShipCardData shipCardData;
    public ShipCard shipUiCard;

    public List<BoardingMarines> boardingMarines;

    public MarineEfficiencyTable marineEfficiencyTable;

    // Cool now we can determine what buttons to press
    public bool CanMoveAndTurn => true;

    public bool CanFullStop => !initiatedFullStop;

    public bool CanTurnSlide => true;

    public bool CanFullSpeedBoost =>
        !hasBoosted
        && !initiatedFullStop
        && (lastMove.previousShipMoveMode == ShipMoveModes.MOVE_AND_TURN);

    [SerializeField]
    private ShipSubsystem[] shipSubsystems;

    public ShipSubsystem[] SecondarySubsystems => shipSubsystems;
    public ShipSubsystem[] AllSubsystems;

    public Dictionary<int, List<AttackInformation>> attackOrders;

    public WeaponController defaultWeapon;

    public HealthStats shipHealth;

    public Explosion normalExplosion;
    public Explosion finaleExplosion;

    public ShipHealthUI shipHealthUI;

    public bool destroyed = false;

    public bool Destroyed => destroyed;

    public ShipMainSystems shipMainSystems;
    public SmokeSystem smokeSystem;

    public bool hasAI = false;

    public ShipNavOverlay navOverlay;

    private bool confirmedMove = false;
    public bool ConfirmedMove => confirmedMove;

    public bool jumped = false;

    public void OverrideStartingHealth(int health)
    {
        shipHealth.startingHealth = health;
        shipHealth.Init();
    }

    public float GetMarineControlPercent
    {
        get
        {
            int sumEnemies = boardingMarines.Sum(p => p.boardingParty);
            return (float)marines / (float)sumEnemies;
        }
    }


    // ---------------------------------------------------------------------------------------------------
    // some collision code.
    // ---------------------------------------------------------------------------------------------------
    [Header("Ship damage system")]
    public float waitToCheckCollision = .2f;
    public float defaultCollisionDamage = 20f;
    bool collisionCheck = false;

    public LayerMask damageLayerMask;

    public Timing collisionTiming;

    // This is required to be your own subsystem.
    public ShipSubsystem priorityRepairSubsystem;

    public List<ShipSubsystem> shipRepairQueue;

    public bool moveable = true;

    public void SelectMoveAndTurn()
    {

        initiatedFullStop = false;
        hasBoosted = false;
        shipMoveModes = ShipMoveModes.MOVE_AND_TURN;


        // add a tiny bit forward
        var offset = (shipMovementEstimator.transform.position - (transform.position - transform.forward * .001f));
        if (offset.magnitude > MaxThrusterRange)
        {
            shipMovementEstimator.transform.position = offset.normalized * MaxThrusterRange + transform.position;
        }

        shipMovementEstimator.transform.rotation = Quaternion.LookRotation(offset.normalized) * Quaternion.Euler(0, 0, zRoll);
        // Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);

        UpdateNavOverlay();
    }

    public void SelectFullStop() {

        if (hasBoosted && !initiatedFullStop)
        {

            initiatedFullStop = true;
            shipMoveModes = ShipMoveModes.FULL_STOP;

            positionUpdate.FullStopOrder();
            var offset = (shipMovementEstimator.transform.position - transform.position);

            shipMovementEstimator.transform.position = offset.normalized * (offset.magnitude / 2f)
                    + transform.position; //slows down to 1 quarter impulse
            positionUpdate.UpdateFullStop(shipMovementEstimator.transform, transform.position, .5f);
        }
        else
        {
            initiatedFullStop = true;
            hasBoosted = false;
            shipMoveModes = ShipMoveModes.FULL_STOP;

            var offset = (shipMovementEstimator.transform.position - transform.position);

            shipMovementEstimator.transform.position = offset.normalized * (offset.magnitude / 2f)
                    + transform.position; //slows down to 1 quarter impulse
            //positionUpdate.UpdateFullStop(shipMovementEstimator.transform, transform.position, .5f);
            //shipMovementEstimator.transform.position = transform.position;

        }
        UpdateNavOverlay();
    }

    public void SelectTurnAndSlide() {
        shipMoveModes = ShipMoveModes.TURN_SLIDE;
        initiatedFullStop = false;
        hasBoosted = false;
        //hasBoosted = true;
        UpdateNavOverlay();
    }

    public void SelectFullSpeedBoost() {
        ResetMove();

        shipMoveModes = ShipMoveModes.FULL_SPEED;
        initiatedFullStop = false;
        hasBoosted = true;

        var offset = (shipMovementEstimator.transform.position - transform.position).normalized;
        shipMovementEstimator.transform.position = offset * MaxThrusterRange + transform.position;
        shipMovementEstimator.transform.rotation = Quaternion.LookRotation(offset.normalized) * Quaternion.Euler(0, 0, zRoll);
        Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);
        UpdateNavOverlay();
    }

    public void ResetMove() {
        shipMovementEstimator.transform.position = lastMove.shipOffset + transform.position;
        SetEstOrientation(lastMove.shipRotation);
        shipMoveModes = lastMove.previousShipMoveMode;
        //TODO" need to set last boosted or initiate stop modes.

        UpdateNavOverlay();
    }

    private void UpdateNavOverlay()
    {
        if (GameManager.Instance.navController.controllingShip == this)
        {
            GameManager.Instance.navController.SetNewTurn(this);
        }
    }

    public void SetTarget(ShipController target)
    {
        targetting = target;
        targettingSubsystem = null;
        GameManager.Instance.uiController.UpdateDisplayShipWeapons(this);
        GameManager.Instance.uiManagerV2?.UpdateUIStatus(this);
    }

    public void ClearTargets(bool clearWeaponQueues)
    {
        //targetting = null;
        //targettingSubsystem = null;
        foreach (var key in attackOrders.Keys)
        {
            attackOrders[key].Clear();
        }

        foreach (var w in weapons)
        {
            if (w.attackInfoOrder != null)
            {
                w.attackInfoOrder.IsSet = false;
            }
        }
    }



    public int BoardTarget()
    {
        int boardingParty = 0;
        if (marines > 0)
        {
            if (marines > boardingActionCapacity)
            {
                boardingParty = boardingActionCapacity;
                marines -= boardingActionCapacity;
            }
            else
            {
                boardingParty = marines;
                marines = 0;
            }

            targetting.IntruderBoardingAction(shipFaction, boardingParty);
        }
        UpdateBoardingSituation();
        return boardingParty;
    }

    private void DebugBoardingAction(BoardingMarines boardingParty, int Marines)
    {
        Debug.Log($"Defending Marine  = {shipFaction} {marines} |VS| {boardingParty.faction} {boardingParty.boardingParty}");
    }

    public void UpdateShipStateOncePerSecond(int round, int second)
    {

        foreach (var boardingParty in boardingMarines)
        {
            DebugBoardingAction(boardingParty, marines);
            DiceRoller.RollDiceForBoardingParty(ref boardingParty.boardingParty, ref marines, efficiency: marineEfficiencyTable.GetMarineEfficenyValue(shipHealth.Percent));

            //boarding party takes control.
            if (boardingParty.boardingParty > marines && marines == 0)
            {
                marines = boardingParty.boardingParty;
                shipFaction = boardingParty.faction;
                boardingMarines.Remove(boardingParty);
                break;
            }

            // nothing happens
            if (boardingParty.boardingParty == 0)
            {
                boardingMarines.Remove(boardingParty);
                break;
            }
        }

        // this code branch is for captured ships. if ship is friendly, DONOT capture it lol
        if (!isPlayerShip && shipFaction == GameManager.Instance.playerFaction) //TODO enemy should be able to recapture ship or re-enforce marines.
        {
            var ai = GetComponent<BaseAIController>();
            if (!ai.isFriendly)
            {
                isPlayerShip = true;

                if (ai != null)
                {
                    ai.enabled = false;
                }
                GameManager.Instance.uiController.SwapEnemyToPlayer(this);

                // emergency repairs... TODO: make the repair kit a thing marines can be equiped with
                if (shipMainSystems.thrusterSystem.systemHealth.IsDead)
                {
                    shipMainSystems.thrusterSystem.Heal(50f);
                    positionUpdate.EnginesOnline();
                }
            }
        }

        UpdateBoardingSituation();
    }

    private void UpdateBoardingSituation()
    {
        int sumEnemies = boardingMarines.Sum(p => p.boardingParty);
        shipUiCard.boardingPartyUI.UpdateAttackDefenseStatus(marines, sumEnemies, shipFaction);

    }

    public void IntruderBoardingAction(ShipFaction shipFaction, int boardingParty)
    {
        var boardingFaction = boardingMarines.Where(p => p.faction == shipFaction).FirstOrDefault();
        if (boardingFaction != null)
        {
            boardingFaction.boardingParty += boardingParty;
        }
        else
        {
            boardingMarines.Add(new BoardingMarines(shipFaction, boardingParty));
        }
        UpdateBoardingSituation();
    }

    public void SetEstPosition(Vector3 maxShipPosition)
    {
        if (!moveable) return;
        
        // clamp range
        if (Vector3.Distance(transform.position, maxShipPosition) > MaxThrusterRange)
        {
            maxShipPosition = (maxShipPosition - transform.position).normalized * MaxThrusterRange + transform.position;
        }
        shipMovementEstimator.transform.position = maxShipPosition;
        manueverOffset = maxShipPosition;
    }

    public void CommitRotation()
    {
        orientation = shipMovementEstimator.transform.rotation;
        zRoll = orientation.eulerAngles.z;
    }

    public void SetEstOrientation(Quaternion rotation)
    {

        orientation = rotation;
        shipMovementEstimator.transform.rotation = orientation;
        // Debug.Log("ship name " + transform.gameObject.name + " received rotation order " + rotation.eulerAngles.ToString());
        // Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);
    }

    public void SetSubsystemTarget(ShipSubsystem shipSubsystemTarget) {
        targettingSubsystem = shipSubsystemTarget;
    }

    public void SetSubsystemRepairPriority(ShipSubsystem shipSubsystemRepairTarget)
    {
        // TODO: main hull does not have this, assume a hull repair order has been issued
        if (shipSubsystemRepairTarget != null && shipSubsystemRepairTarget.HealthPercent < 1)
        {
            priorityRepairSubsystem = shipSubsystemRepairTarget;

            if (!shipRepairQueue.Contains(shipSubsystemRepairTarget))
            {
                shipRepairQueue.Add(shipSubsystemRepairTarget);
            }
        }
    }


    void OnEnable()
    {
        if (gm == null) gm = GameManager.Instance;

        GameManager.Instance.uiController.SetupShipUI(this);

        Debug.Log($"ship spawned via enable {gameObject.name}");
    }

    // Start is called before the first frame update
    void Awake()
    {

        gm = GameManager.Instance;

        gm.AddSimulator(this);

        positionUpdate = new SimVector3Update();

        rotationUpdate = new SimQuaternionUpdate();

        if (moveable)
        {
            shipMovementEstimator.SetActive(false);
            manueverOffset = shipMovementEstimator.transform.position;
            orientation = shipMovementEstimator.transform.rotation;

            positionUpdate.simTarget = shipMovementEstimator.transform.position;
            rotationUpdate.simTarget = shipMovementEstimator.transform.rotation;
        }
        //Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);
            if (weapons != null)
            {
                //int wepMount = 0;
                foreach (var item in weapons)
                {
                    item.Init();
                    item.ship = this;
                    //item.mountPoint = wepMount;
                    //wepMount++;
                }
            }
        shipHealth.Init();
        smokeSystem.Init();

        attackOrders = new Dictionary<int, List<AttackInformation>>();
        collisionTiming.duration = waitToCheckCollision;
        collisionTiming.Init();

        //shipSubsystems = GetComponentsInChildren<ShipSubsystem>();
        AllSubsystems = shipSubsystems.Concat(weapons).ToArray();
        if (shipMainSystems.thrusterSystem != null)
        {
            AllSubsystems = AllSubsystems
                .Append(shipMainSystems.thrusterSystem).ToArray();
        }
        
        boardingMarines = new List<BoardingMarines>();
        var ai = GetComponent<BaseAIController>();
        if (ai != null) { hasAI = true; }
    }
    public bool instantDestroyEngines = false;

    [HideInInspector]
    public bool uiInitialized = false;

    void Start()
    {
        navOverlay = GetComponent<ShipNavOverlay>();
        shipRepairQueue = new List<ShipSubsystem>();
        // prime the space ship for continuos movement
        if (moveable)
        {
            positionUpdate.StartSim(transform.position, shipMovementEstimator.transform.position);
        }

        confirmedMove = true;
    }

    // Update is called once per frame
    void Update()
    {
        if (instantDestroyEngines)
        {
            shipMainSystems.thrusterSystem.Damage(50, null);
            instantDestroyEngines = false;
        }

        // prevent user or AI controller from adjusting estimator when ship is broke.
        if (positionUpdate.autoDrift && GameManager.Instance.simulationController.SimulationState != SimulationState.Simulating && moveable)
        {
            shipMovementEstimator.transform.position = positionUpdate.driftingDirection + transform.position;
            shipMovementEstimator.transform.rotation = rotationUpdate.simStart;
            //Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);
        }
        else
        {
            //shipMovementEstimator.transform.position = positionUpdate.simTarget;
        }
    }

    public void EnableEstimator(bool show, NavMove nav)
    {
        if (moveable)
        {
            if (show)
            {
                shipMovementEstimator.SetActive(true);
                nav.transform.position = manueverOffset;


                NavWidgetRoll.SetActive(false);
                NavWidgetRtn.SetActive(false);
                nav.ShowWidget(false);

            }
            else
            {
                shipMovementEstimator.SetActive(false);
            }
        }
    }

    // TODO: add a "M" hot key to move ship
    public void EnterMoveMode(NavMove nav)
    {
        if (moveable)
        {
            NavWidgetRoll.SetActive(true);
            NavWidgetRtn.SetActive(true);
            nav.ShowWidget(true);
            confirmedMove = false;
            //Debug.Log("Entered move mode...");
        }
    }


    public void ConfirmMoveMode(NavMove nav)
    {
        if (moveable)
        {
            NavWidgetRoll.SetActive(false);
            NavWidgetRtn.SetActive(false);
            nav.ShowWidget(false);
            confirmedMove = true;
            //Debug.Log("Confirm move mode...");
        }
    }

    public void SetWeaponTarget(int weaponN, ShipController target)
    {

    }

    public void ResetWeaponCooldown()
    {
        foreach (var wep in weapons)
        {
            wep.ResetCooldown();
        }
    }

    public void FireWeaponIfQueued(int second)
    {
        if (attackOrders.ContainsKey(second))
        {
            foreach (var weps in attackOrders[second])
            {
                //Debug.Log($"Round {GameManager.Instance.currentTurnNumber} weapon {second}s last fired {weps.weaponController.lastFired}");

                if (weps.weaponController.lastFired == -1)
                {
                    weps.weaponController.Fire(targetting, this, second, targettingSubsystem); // TODO add clear subsystem targeting...
                    weps.weaponController.lastFired = GameManager.Instance.currentTurnNumber;
                }

            }
        }
    }

    public void UpdateSim(float timePercent, float deltaTime)
    {
        //if (shipMainSystems.thrusterSystem != null && !shipMainSystems.thrusterSystem.systemHealth.IsDead)
        //{            
        if (moveable)
        {
            shipMovementEstimator.transform.position = positionUpdate.simTarget;
            shipMovementEstimator.transform.rotation = rotationUpdate.simTarget;

            //transform.position = positionUpdate.UpdateSim(timePercent);
            //transform.rotation = rotationUpdate.UpdateSim(timePercent);
            //}

            transform.position = positionUpdate.UpdateSim(timePercent);

            if (!positionUpdate.autoDrift)
            {
                transform.rotation = rotationUpdate.UpdateSim(timePercent);
            }
        }
        //var toSecond = Mathf.timePercent * 10;
            CollisionDamageSimulator(timePercent);

        if (targetting != null && targetting.Destroyed)
        {
            targetting = null;
        }

        // Drifting code moved to end of sim logic.

        // This code updates engine FX
        if (shipMainSystems != null & shipMainSystems.thrusterSystem != null)
        {
            shipMainSystems.thrusterSystem.UpdateThrusterPower(timePercent * 10f, shipMoveModes);
        }
    }

    public void OnStartSim()
    {
        CheckDrifting();

        if (moveable)
        {
            positionUpdate.StartSim(transform.position, shipMovementEstimator.transform.position);
            rotationUpdate.StartSim(transform.rotation, shipMovementEstimator.transform.rotation);
            //Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);

            Debug.DrawLine(transform.position, transform.position + shipMovementEstimator.transform.rotation * Vector3.forward * 10, Color.green, 10f);

            lastMove.SetLastMove(shipMovementEstimator.transform.position - transform.position, shipMovementEstimator.transform.rotation, shipMoveModes);
        }
    }

    public void OnStopSim()
    {
        if (!hasAI)
        {
            shipMovementEstimator.transform.position = transform.position + positionUpdate.offsetNewTurn;
        }

        CheckDrifting();

        if (initiatedFullStop)
        {
            var offset = (shipMovementEstimator.transform.position - transform.position);
            //if (offset.magnitude > MaxThrusterRange)
            //{
            shipMovementEstimator.transform.position = offset.normalized * (maxThrusterRangeValue / 2f) * positionUpdate.fullStopCountDown
                + transform.position; //slows down to 1 quarter impulse
            positionUpdate.UpdateFullStop(shipMovementEstimator.transform, transform.position, .5f);
            //}
        }

        positionUpdate.StartSim(transform.position, shipMovementEstimator.transform.position);
        rotationUpdate.StartSim(transform.rotation, shipMovementEstimator.transform.rotation);
        // Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);

        // new turn ship automatically resets movement confirmation.
        //confirmedMove = false;
        confirmedMove = true;

    }

    private void CheckDrifting() {
        // this should cause the ship to begin drifting
        if (shipMainSystems.thrusterSystem != null && shipMainSystems.thrusterSystem.systemHealth.IsDead && !positionUpdate.autoDrift)
        {
            positionUpdate.Drift(shipMovementEstimator.transform, transform.position, 0);
            shipMovementEstimator.transform.position = positionUpdate.simTarget + positionUpdate.driftingDirection;
            shipMovementEstimator.transform.rotation = rotationUpdate.simTarget;
            // Debug.Log("ship name " + transform.gameObject.name + " comiting rotation " + shipMovementEstimator.transform.rotation.eulerAngles.ToString() + " turn " + GameManager.Instance.currentTurnNumber);
        }
    }

    public void DestroySim()
    {
    }

    IEnumerator DelayArmorImpact(Vector3 expPosition)
    {
        yield return new WaitForSeconds(impactExpDelay);
        //AudioSource.PlayClipAtPoint(GameManager.Instance.ArmorImpact, expPosition);
    }

    IEnumerator DelayExplosion(Vector3 expPosition)
    {
        yield return new WaitForSeconds(impactExpDelay);
        //var sim = Instantiate(explosionImpact, expPosition, Quaternion.identity);

        //GameManager.Instance.AddSimulator(sim);
        //sim.StartSim();
    }

    IEnumerator DestroyShipCoroutine()
    {
        GameManager.Instance.RemoveShip(this); //fuck it, lets blow it up!

        yield return new WaitForSeconds(.5f);
        gameObject.SetActive(false);

        // Destroy(gameObject); // TODO Fix this!
    }

    //public void QueueWeaponAttack(int second)
    //{
    //    //todo append if exists
    //    attackOrders.Add(second, new List<AttackInformation> { new AttackInformation()
    //    {
    //        weaponController = defaultWeapon
    //    }});
    //}


    public bool CheckAndDequeueAttack(int second, WeaponController weapon) {

        if (weapon.attackInfoOrder != null) {
            var secondSlot = weapon.attackInfoOrder.secondSlot;
            if (secondSlot == second) {
                attackOrders[secondSlot].Remove(weapon.attackInfoOrder);
                return true;
            }
        }

        return false;
    }

    public void QueueWeaponAttack(int second, WeaponController weapon)
    {


        // remove this thing first.
        if (weapon.attackInfoOrder != null)
        {
            attackOrders[weapon.attackInfoOrder.secondSlot].Remove(weapon.attackInfoOrder);
            //Debug.Log($"removing weapon of type ${weapon.transform.name} slot {weapon.attackInfoOrder.secondSlot} from ship {transform.name}");
        }
        else
        {
            //Debug.Log("NO WEAPON REMOVED!");
        }

        //todo append if exists
        var attackInfo = new AttackInformation()
        {
            weaponController = weapon,
            secondSlot = second
        };
        // add weapon attack info to the weapon controller, this will help track
        // what happens to it.
        weapon.attackInfoOrder = attackInfo;

        if (attackOrders.ContainsKey(second))
        {
            attackOrders[second].Add(attackInfo);
        }
        else
        {
            attackOrders.Add(second, new List<AttackInformation>() { attackInfo });
        }

        //TODO remove debug
        //GameManager.Instance.uiController.LogWaponQueue(attackOrders);
    }

    public void LoadShipDamage(ShipSave shipSave)
    {
        StartCoroutine(SetupAfterUILoads(shipSave));
    }

    
    IEnumerator SetupAfterUILoads(ShipSave shipSave)
    {
        yield return new WaitForNextFrameUnit();
        var hullDamage = shipSave.shipHealthRemaining.ToDamage;
        TakeDamage(hullDamage, null);

        var thrusterDamage = shipSave.mainThruster.healthRemaining.ToDamage;
        shipMainSystems.thrusterSystem.Damage(thrusterDamage, null);
        //shipSave.subsystemSaves = shipSave.subsystemSaves.OrderBy(p => p.subsystemId).ToArray();
        //shipSave.weaponControllerSaves = shipSave.weaponControllerSaves;

        //shipSubsystems = shipSubsystems.OrderBy(p => p.id).ToArray();
        for (int i = 0; i < shipSave.subsystemSaves.Length; i++)
        {
            var damage = shipSave.subsystemSaves[i].healthRemaining.ToDamage;
            shipSubsystems[i].Damage(damage, null, true);
        }

        // weapons = weapons.OrderBy(p => p.weaponData.GetCustomShipWeaponId()).ToList();// lets try skipping the sorting.
        for (int i = 0; i < shipSave.weaponControllerSaves.Length; i++)
        {
            var damage = shipSave.weaponControllerSaves[i].healthRemaining.ToDamage;

            weapons[i].Init();
            weapons[i].Damage(damage, null);
        }
    }


    public void TakeDamage(float damage, FiredEvent firedEvent, bool internalDamage = false)
    {
        Debug.Log($"{gameObject.name} Takes {damage} damage");
        shipHealth.TakeDamage(damage);
        if (internalDamage)
        {
            Instantiate(normalExplosion, transform.position, Quaternion.identity);
        }

        var aiChecks = GetComponent<BaseAIController>();
        if(aiChecks != null && firedEvent != null){
            aiChecks.IfFiredUponAlert(firedEvent.firedShip);
        }
        //Debug.Log($"{gameObject.name} Takes {damage} damage");

        shipHealthUI.healthSlider.value = shipHealth.Percent;
        smokeSystem.CheckTriggerSmoke(shipHealth.Percent);


        if (shipHealth.IsDead && !destroyed)
        {
            // ship explodes.
            var sim = Instantiate(finaleExplosion, transform.position, Quaternion.identity);
            //GameManager.Instance.AddSimulator(
            //    sim
            //);
            destroyed = true;
            Destroy(shipHealthUI.gameObject);
            StartCoroutine(DestroyShipCoroutine());
            // Debug.Log("Spawned explosion for " + transform.name);

        }
    }


    //easy to just hack the physics masking table for now
    void OnCollisionStay(Collision other)
    {
        var mask = damageLayerMask | 1 << other.transform.gameObject.layer;

        Debug.Log($"other collision {other.transform.name} check {collisionCheck} mask {(int)damageLayerMask}=={mask}");

        if (!collisionCheck
            &&
            (damageLayerMask == mask) && other.gameObject.tag != "Missile") // missile will deal damage on its own.
        {
            collisionCheck = true;
            collisionTiming.Init();
            //StartCoroutine(CollisionDamage());
        }
    }

    //IEnumerator CollisionDamage()
    //{

    //    //Debug.Log("do damage");
    //    if (this != null && !shipHealth.IsDead)
    //    {
    //        TakeDamage(defaultCollisionDamage, true);
    //    }

    //    yield return new WaitForSeconds(waitToCheckCollision);

    //    collisionCheck = false;
    //}

    private void CollisionDamageSimulator(float deltaTime)
    {
        if (collisionCheck && collisionTiming.Completed())
        {
            if (this != null && !shipHealth.IsDead)
            {
                TakeDamage(defaultCollisionDamage, null, true);
            }

            collisionCheck = false;
            collisionTiming.Init();
        }
    }

    public void BeforeSimStart()
    {
    }

    public void BeforeSimmStop()
    {
    }

    public bool CanBoardTarget()
    {

        if (targetting != null)
        {
            // Debug.Log("distance to target = " + GetDisantceToTarget + " | B - range = " + BoardingRange);
            return GetDisantceToTarget <= BoardingRange;
        }
        else
            return false;
        // also need enemy ships engines to be offline.
    }

    public float GetDisantceToTarget
    {
        get
        {
            if (targetting != null)
            {
                return Vector3.Distance(targetting.transform.position, transform.position);
            }
            else
            {
                return int.MaxValue;
            }
        }
    }
}

[Serializable]
public class SimVector3Update
{
    public Vector3 simStart;
    public Vector3 simTarget;

    public Vector3 offsetNewTurn;
    public Vector3 endingVelocity = Vector3.zero;
    //public Vector3 currentVelocity = Vector3.zero;

    Vector3 controlPoint2;

    Vector3 lastVelocity = Vector3.zero;

    public bool autoDrift = false;

     float driftFactor = .25f;

    public Vector3 driftingDirection = Vector3.zero;

    float offsetTime = 0;

    public int fullStopCountDown = 0;

    public void Drift(Transform shipEst, Vector3 currrentStart, float oftime, float minDrifSpeed = 5)
    {
        autoDrift = true;
        driftingDirection = (shipEst.position - simStart) * driftFactor;
        offsetTime = oftime;
        simStart = currrentStart;
        //simTarget = ship.position + (simTarget - simStart) * driftFactor;
        //simStart = ship.position;
    }

    public void ManuallySetSlideVector(Vector3 slideVector)
    {
        lastVelocity = slideVector;
    }

    public void UpdateFullStop(Transform shipEst, Vector3 currentStart, float slowDownFactor){
        if(fullStopCountDown > 0){
            fullStopCountDown--;
            StartSim(currentStart, shipEst.transform.position);
            controlPoint2 = -lastVelocity * 2 + currentStart;

        }else{
            shipEst.transform.position = currentStart;
            simStart = currentStart;
            simTarget = currentStart;
        }
        
    }

    public void EnginesOnline(){
        autoDrift = false;
    }

    // public void FullStop(Transform ship){
    //     simStart = ship.transform.position;
    //     simTarget = ship.transform.position;
    // }

    public void StartSim(Vector3 start, Vector3 target)
    {
        offsetTime = 0;
        if (!autoDrift)
        {
            simStart = start;
            simTarget = target;

            offsetNewTurn = simTarget - simStart;

            if (lastVelocity == Vector3.zero)
            {
                lastVelocity = offsetNewTurn;
            }

            controlPoint2 = lastVelocity / 2.5f + start;

        }
        else
        {
            // if drift is on, we do need ship position currently to continue
            simStart = start;
            simTarget = driftingDirection + start;

            controlPoint2 = driftingDirection * 0.5f + start;

        }

        if(target == start) // this should be true on full stop.
        {
            controlPoint2 = target;
        }
    }

    public Vector3 UpdateSim(float percent)
    {
        //currentVelocity = endingVelocity;
        lastVelocity = simTarget - controlPoint2;

        return Bezier(simStart, controlPoint2,  simTarget, percent - offsetTime);
    }

    /// <returns></returns>
    public Vector3 GetPointOnRouteDuringSim(float t)
    {
        return Bezier(simStart, controlPoint2,  simTarget, t);
    }


    /// <summary>
    /// Gets a point along the bezier. 
    /// </summary>
    /// <param name="t">T is the current location we are drawing from 0...to...1.</param>
    public Vector3 GetPointOnRouteBeforeSim(Vector3 start, Vector3 target, float t)
    {
        // simulation values:

        var offsetNewTurnX1 = target - start;

        if (lastVelocity != Vector3.zero)
        {
            //currentVelocity = offsetNewTurn;
            offsetNewTurnX1 = lastVelocity;
        }


        var controlPoint2X1 = offsetNewTurnX1 / 2.5f + start;
        //WireframeCube.DrawLine(start, target, Color.red, 0);
        return Bezier(start, controlPoint2X1, target, t);
    }

    Vector3 Bezier(Vector3 a, Vector3 b, float t) {
        return Vector3.Lerp(a, b, t);
    }

    Vector3 Bezier(Vector3 a, Vector3 b, Vector3 c, float t) {
        return Vector3.Lerp(Bezier(a, b, t), Bezier(b, c, t), t);
    }

    Vector3 Bezier(Vector3 a, Vector3 b, Vector3 c, Vector3 d, float t) {
        return Vector3.Lerp(Bezier(a, b, c, t), Bezier(b, c, d, t), t);
    }

    // in the direction we're moving, use 1/4 of max thrust, but also counter balance with backward spline weight.
    public void FullStopOrder()
    {
        //throw new NotImplementedException();
        fullStopCountDown = 1;
    }
}

public class ShipControllerEvents
{
    public event ShipEventTriggered shipCreated;
    public event ShipEventTriggered shipDamaged;
    public event ShipEventTriggered ShipRepaired;
    public event ShipEventTriggered ShipCaptured;

    public event ShipEventTriggered ShipDestroyed;
}

public delegate void ShipEventTriggered(ShipEvent shipEvent);

public class ShipEvent{
    public ShipController shipController;
    public ShipEventType eventType;
}

public enum ShipEventType {

    ShipCreated = 0,
    ShipDamaged = 1,
    ShipRepaired = 2,
    ShipCaptured = 3,
    // more events go here.
    ShipDestroyed = 16

}

public static class WireframeCube
{
    public static void DrawWireframeCube(Vector3 center, float size, Color color, float duration)
    {
        Vector3 halfSize = Vector3.one * size * 0.5f;
        Vector3[] corners = new Vector3[8];

        // Calculate the positions of each corner of the cube
        for (int i = 0; i < 8; i++)
        {
            corners[i] = center + new Vector3(
                (i & 1) == 0 ? -halfSize.x : halfSize.x,
                (i & 2) == 0 ? -halfSize.y : halfSize.y,
                (i & 4) == 0 ? -halfSize.z : halfSize.z
            );
        }

        // Draw the lines between the corners
        DrawLine(corners[0], corners[1], color, duration);
        DrawLine(corners[1], corners[3], color, duration);
        DrawLine(corners[3], corners[2], color, duration);
        DrawLine(corners[2], corners[0], color, duration);

        DrawLine(corners[4], corners[5], color, duration);
        DrawLine(corners[5], corners[7], color, duration);
        DrawLine(corners[7], corners[6], color, duration);
        DrawLine(corners[6], corners[4], color, duration);

        DrawLine(corners[0], corners[4], color, duration);
        DrawLine(corners[1], corners[5], color, duration);
        DrawLine(corners[2], corners[6], color, duration);
        DrawLine(corners[3], corners[7], color, duration);
    }

    public static void DrawLine(Vector3 start, Vector3 end, Color color, float duration)
    {
        Debug.DrawLine(start, end, color, duration);
    }
}


[Serializable]
public class SimQuaternionUpdate
{
    public Quaternion simStart;
    public Quaternion simTarget;
    // maintain same heading.

    public void StartSim(Quaternion start, Quaternion target)
    {
        simStart = start;
        simTarget = target;
    }

    public void FullStop(Transform ship){
        simStart = ship.transform.rotation;
        simTarget = ship.transform.rotation;
    }

    public Quaternion UpdateSim(float percent)
    {
        return Quaternion.Slerp(simStart, simTarget, percent);
    }

}


public class FiredEvent{
    public ShipController firedShip;
}