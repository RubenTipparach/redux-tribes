using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ActionQueueUI : MonoBehaviour
{
    // TODO: add more info on it later.

    public InfoWeaponDot attackDot;

    //public GameObject dotHolder;

    
    // max number of weapons that cna be queues here.
    public int possibleQueues = 10;

    public void AttackMark()
    {
        attackDot.gameObject.SetActive(true);
    }

    public void AttackUnmark()
    {
        attackDot.gameObject.SetActive(false);
    }

    // Start is called before the first frame update
    void Start()
    {
        //attackIcons = new List<GameObject>();
        //for(int i = 0; i < possibleQueues; i++){
        //var attackIconInst = Instantiate(attackIcon, dotHolder.transform);
        //attackIcons.Add(attackIconInst);
        //}

    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void ClearUI()
    {
        AttackUnmark();
    }

    public void ActivateUI(List<AttackInformation> attacks){
        attackDot.SetWeaponInfo(attacks);
        attackDot.gameObject.SetActive(true);

        // for(int i = 0; i < attacks.Count; i++){
        //     attackIcons[i].SetActive(true);
        // }
    }
}
