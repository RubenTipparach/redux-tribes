using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;

public class DebugWindow : MonoBehaviour
{
    // Start is called before the first frame update
    void Start()
    {
#if UNITY_EDITOR
        gameObject.SetActive(true);
#else
        gameObject.SetActive(false);
#endif
    }

    public void AutoBoardMarines(){
        var player = GameManager.Instance.ships.Where(p => p.isPlayerShip).Single();
        var enemies =  GameManager.Instance.ships.Where(p => !p.isPlayerShip).ToArray();
        foreach (var en in enemies)
        {
            en.AutoCaptureProcedure(player.shipFaction);
        }
    }

    public void BoardAndWinCurrentTarget(){
        if (GameManager.Instance.shipSelected != null
            && GameManager.Instance.shipSelected.Targeting != null
            && GameManager.Instance.shipSelected.isPlayerShip)
        {
            var en = GameManager.Instance.shipSelected.Targeting;
            en.AutoCaptureProcedure(GameManager.Instance.shipSelected.shipFaction);

        }
    }

    public void DefeatCurrentTarget(){
        if (GameManager.Instance.shipSelected != null
            && GameManager.Instance.shipSelected.Targeting != null)
        {
            StartCoroutine(BlowUpTarget());
        }
    }

    public void DisableSubsystemTarget(){
        if (GameManager.Instance.shipSelected != null
            && GameManager.Instance.shipSelected.targettingSubsystem != null)
        {
            StartCoroutine(BlowUpSubsystem());
        }
    }

    IEnumerator BlowUpSubsystem(){


        GameManager.Instance.EndTurn();
        yield return new WaitForSeconds(1);

        var target = GameManager.Instance.shipSelected.targettingSubsystem;
        var health = target.SubsystemHealth.currentHealth;
        target.Damage(health, null, true);        
    }

    IEnumerator BlowUpTarget()
    {
        GameManager.Instance.EndTurn();
        yield return new WaitForSeconds(1);

        var target = GameManager.Instance.shipSelected.Targeting;
        target.TakeDamage(1000000, null);
    }

    public void DefeatAll(){
        GameManager.Instance.EndTurn();
        StartCoroutine(BlowUPAll());
    }


    public void DefeatAllEnemies(){
        GameManager.Instance.EndTurn();
        StartCoroutine(BlowUPEnemies());
    }

    IEnumerator BlowUPEnemies(){
        yield return new WaitForSeconds(1);

        var enemies =  GameManager.Instance.ships.Where(p => !p.isPlayerShip && !p.isFriendly).ToArray();
        foreach (var en in enemies)
        {
            en.TakeDamage(1000000, null);
        }
    }

    IEnumerator BlowUPAll(){
        yield return new WaitForSeconds(1);

        var enemies =  GameManager.Instance.ships.Where(p => !p.isPlayerShip).ToArray();
        foreach (var en in enemies)
        {
            en.TakeDamage(1000000, null);
        }
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
